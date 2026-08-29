import crypto from "node:crypto";

import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";

import { isoBase64URL } from "@simplewebauthn/server/helpers";

import {
  getServiceClient,
  ORIGIN,
  RP_ID,
  isAuthenticated,
  getSessionCredentialId,
  readJsonBody,
  createSessionToken,
  serializeSessionCookie,
} from "./_utils.js";

const PAIRING_TTL_MS = 5 * 60 * 1000;

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createCode() {
  return crypto.randomBytes(8).toString("hex").toUpperCase().slice(0, 10);
}

function isExpired(pairing) {
  return new Date(pairing.expires_at).getTime() <= Date.now();
}

async function getPairing(supabase, pairingId) {
  const { data, error } = await supabase
    .from("webauthn_pairing")
    .select("*")
    .eq("id", pairingId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({
      error: "Method not allowed",
    });
    return;
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  try {
    const action =
      typeof req.query?.action === "string" ? req.query.action : "";

    const supabase = getServiceClient();

    /*
     * ==========================================================
     * START DEVICE PAIRING
     * ==========================================================
     */

    if (action === "start") {
      if (!isAuthenticated(req)) {
        res.status(401).json({
          error: "Not authenticated",
        });
        return;
      }

      const credentialId = getSessionCredentialId(req);

      if (!credentialId) {
        res.status(401).json({
          error: "Your session is not associated with a device",
        });
        return;
      }

      const body = await readJsonBody(req);

      const deviceName =
        typeof body.deviceName === "string"
          ? body.deviceName.trim().slice(0, 80)
          : "";

      const deviceType =
        typeof body.deviceType === "string"
          ? body.deviceType.trim().slice(0, 40)
          : "Passkey";

      if (!deviceName) {
        res.status(400).json({
          error: "Device name is required",
        });
        return;
      }

      await supabase
        .from("webauthn_pairing")
        .delete()
        .eq("initiator_credential_id", credentialId)
        .lt("expires_at", new Date().toISOString());

      const pairingId = crypto.randomUUID();

      const code = createCode();

      const initialSecret = crypto.randomBytes(32).toString("base64url");

      const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();

      const { error } = await supabase.from("webauthn_pairing").insert({
        id: pairingId,

        code_hash: hash(code),

        secret_hash: hash(initialSecret),

        initiator_credential_id: credentialId,

        status: "waiting",

        requested_device_name: deviceName,

        requested_device_type: deviceType,

        expires_at: expiresAt,
      });

      if (error) {
        throw error;
      }

      res.status(200).json({
        pairingId,
        code,
        expiresAt,
        deviceName,
        deviceType,
      });

      return;
    }

    /*
     * ==========================================================
     * REQUEST DEVICE PAIRING
     * ==========================================================
     */

    if (action === "request") {
      const body = await readJsonBody(req);

      const code =
        typeof body.code === "string"
          ? body.code.trim().replace(/\s/g, "").toUpperCase()
          : "";

      const deviceName =
        typeof body.deviceName === "string"
          ? body.deviceName.trim().slice(0, 80)
          : "";

      const deviceType =
        typeof body.deviceType === "string"
          ? body.deviceType.trim().slice(0, 40)
          : "Passkey";

      if (!code) {
        res.status(400).json({
          error: "Pairing code is required",
        });
        return;
      }

      if (!deviceName) {
        res.status(400).json({
          error: "Device name is required",
        });
        return;
      }

      const { data: pairing, error } = await supabase
        .from("webauthn_pairing")
        .select("*")
        .eq("code_hash", hash(code))
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!pairing) {
        res.status(404).json({
          error: "Invalid or expired pairing code",
        });
        return;
      }

      if (isExpired(pairing)) {
        await supabase
          .from("webauthn_pairing")
          .update({
            status: "expired",
          })
          .eq("id", pairing.id);

        res.status(410).json({
          error: "This pairing code has expired",
        });

        return;
      }

      if (pairing.status !== "waiting") {
        res.status(409).json({
          error: "This pairing code has already been used",
        });

        return;
      }

      const secret = crypto.randomBytes(32).toString("base64url");

      const { error: updateError } = await supabase
        .from("webauthn_pairing")
        .update({
          status: "pending_approval",

          secret_hash: hash(secret),

          requested_device_name: deviceName,

          requested_device_type: deviceType,
        })
        .eq("id", pairing.id);

      if (updateError) {
        throw updateError;
      }

      res.status(200).json({
        pairingId: pairing.id,

        secret,

        status: "pending_approval",

        deviceName,

        deviceType,

        expiresAt: pairing.expires_at,
      });

      return;
    }

    /*
     * ==========================================================
     * DEVICE PAIRING STATUS
     * ==========================================================
     */

    if (action === "status") {
      const body = await readJsonBody(req);

      const pairingId =
        typeof body.pairingId === "string" ? body.pairingId : "";

      const secret = typeof body.secret === "string" ? body.secret : "";

      if (!pairingId) {
        res.status(400).json({
          error: "Pairing ID is required",
        });
        return;
      }

      const pairing = await getPairing(supabase, pairingId);

      if (!pairing) {
        res.status(404).json({
          error: "Pairing not found",
        });
        return;
      }

      if (isExpired(pairing)) {
        res.status(410).json({
          error: "Pairing has expired",
        });
        return;
      }

      /*
       * New device status.
       */
      if (secret) {
        if (hash(secret) !== pairing.secret_hash) {
          res.status(403).json({
            error: "Invalid pairing secret",
          });
          return;
        }

        res.status(200).json({
          ok: true,

          role: "new_device",

          status: pairing.status,

          pairingId: pairing.id,

          deviceName: pairing.requested_device_name,

          deviceType: pairing.requested_device_type,

          expiresAt: pairing.expires_at,
        });

        return;
      }

      /*
       * Trusted device status.
       */
      if (!isAuthenticated(req)) {
        res.status(401).json({
          error: "Not authenticated",
        });
        return;
      }

      const credentialId = getSessionCredentialId(req);

      if (credentialId !== pairing.initiator_credential_id) {
        res.status(403).json({
          error: "Not authorized",
        });
        return;
      }

      res.status(200).json({
        ok: true,

        role: "trusted_device",

        status: pairing.status,

        pairingId: pairing.id,

        deviceName: pairing.requested_device_name,

        deviceType: pairing.requested_device_type,

        expiresAt: pairing.expires_at,
      });

      return;
    }

    /*
     * ==========================================================
     * APPROVE DEVICE
     * ==========================================================
     */

    if (action === "approve") {
      if (!isAuthenticated(req)) {
        res.status(401).json({
          error: "Not authenticated",
        });

        return;
      }

      const credentialId = getSessionCredentialId(req);

      const body = await readJsonBody(req);

      const pairingId =
        typeof body.pairingId === "string" ? body.pairingId : "";

      if (!pairingId) {
        res.status(400).json({
          error: "Pairing ID is required",
        });

        return;
      }

      const pairing = await getPairing(supabase, pairingId);

      if (!pairing) {
        res.status(404).json({
          error: "Pairing not found",
        });

        return;
      }

      if (pairing.initiator_credential_id !== credentialId) {
        res.status(403).json({
          error: "Not authorized",
        });

        return;
      }

      if (isExpired(pairing)) {
        res.status(410).json({
          error: "Pairing has expired",
        });

        return;
      }

      if (pairing.status !== "pending_approval") {
        res.status(409).json({
          error: "No device is waiting for approval",
        });

        return;
      }

      const now = new Date().toISOString();

      const { error: updateError } = await supabase
        .from("webauthn_pairing")
        .update({
          status: "approved",

          approved_at: now,
        })
        .eq("id", pairingId);

      if (updateError) {
        throw updateError;
      }

      res.status(200).json({
        approved: true,
        status: "approved",
      });

      return;
    }

    /*
     * ==========================================================
     * PASSKEY REGISTRATION OPTIONS FOR NEW DEVICE
     * ==========================================================
     */

    if (action === "options") {
      const body = await readJsonBody(req);

      const pairingId =
        typeof body.pairingId === "string" ? body.pairingId : "";

      const secret = typeof body.secret === "string" ? body.secret : "";

      if (!pairingId || !secret) {
        res.status(400).json({
          error: "Pairing credentials are required",
        });

        return;
      }

      const pairing = await getPairing(supabase, pairingId);

      if (!pairing) {
        res.status(404).json({
          error: "Pairing not found",
        });

        return;
      }

      if (hash(secret) !== pairing.secret_hash) {
        res.status(403).json({
          error: "Invalid pairing secret",
        });

        return;
      }

      if (isExpired(pairing)) {
        res.status(410).json({
          error: "Pairing has expired",
        });

        return;
      }

      if (pairing.status !== "approved") {
        res.status(409).json({
          error: "The trusted device has not approved this device yet",
        });

        return;
      }

      const challengeId = `pair:${pairingId}`;

      const { data: existingCredentials, error: credentialsError } =
        await supabase.from("webauthn_credential").select("id");

      if (credentialsError) {
        throw credentialsError;
      }

      const options = await generateRegistrationOptions({
        rpName: "Pocket",

        rpID: RP_ID,

        userName: "viren",

        userDisplayName: "Viren Patel",

        attestationType: "none",

        excludeCredentials: (existingCredentials || []).map((credential) => ({
          id: credential.id,
        })),

        authenticatorSelection: {
          residentKey: "required",

          userVerification: "required",

          authenticatorAttachment: "platform",
        },
      });

      const { error: challengeError } = await supabase
        .from("webauthn_challenge")
        .upsert({
          id: challengeId,

          challenge: options.challenge,

          updated_at: new Date().toISOString(),
        });

      if (challengeError) {
        throw challengeError;
      }

      res.status(200).json(options);

      return;
    }

    /*
     * ==========================================================
     * COMPLETE DEVICE PAIRING
     * ==========================================================
     */

    if (action === "complete") {
      const body = await readJsonBody(req);

      const pairingId =
        typeof body.pairingId === "string" ? body.pairingId : "";

      const secret = typeof body.secret === "string" ? body.secret : "";

      const deviceName =
        typeof body.deviceName === "string"
          ? body.deviceName.trim().slice(0, 80)
          : "";

      const deviceType =
        typeof body.deviceType === "string"
          ? body.deviceType.trim().slice(0, 40)
          : "Passkey";

      if (!pairingId || !secret || !deviceName) {
        res.status(400).json({
          error: "Pairing information is incomplete",
        });

        return;
      }

      const pairing = await getPairing(supabase, pairingId);

      if (!pairing) {
        res.status(404).json({
          error: "Pairing not found",
        });

        return;
      }

      if (hash(secret) !== pairing.secret_hash) {
        res.status(403).json({
          error: "Invalid pairing secret",
        });

        return;
      }

      if (isExpired(pairing)) {
        res.status(410).json({
          error: "Pairing has expired",
        });

        return;
      }

      if (pairing.status !== "approved") {
        res.status(409).json({
          error: "Device pairing has not been approved",
        });

        return;
      }

      const challengeId = `pair:${pairingId}`;

      const { data: challengeRow, error: challengeError } = await supabase
        .from("webauthn_challenge")
        .select("challenge")
        .eq("id", challengeId)
        .maybeSingle();

      if (challengeError) {
        throw challengeError;
      }

      if (!challengeRow) {
        res.status(400).json({
          error: "No pending device registration",
        });

        return;
      }

      const verification = await verifyRegistrationResponse({
        response: body.registration,

        expectedChallenge: challengeRow.challenge,

        expectedOrigin: ORIGIN,

        expectedRPID: RP_ID,

        requireUserVerification: true,
      });

      if (!verification.verified || !verification.registrationInfo) {
        res.status(400).json({
          error: "Device verification failed",
        });

        return;
      }

      const { credentialID, credentialPublicKey, counter } =
        verification.registrationInfo;

      const now = new Date().toISOString();

      const { error: insertError } = await supabase
        .from("webauthn_credential")
        .insert({
          id: credentialID,

          public_key: Buffer.from(credentialPublicKey).toString("base64"),

          counter,

          transports: (body.registration?.response?.transports || []).join(","),

          device_name: deviceName,

          device_type: deviceType,

          created_at: now,

          last_used_at: now,
        });

      if (insertError) {
        if (insertError.code === "23505") {
          res.status(409).json({
            error: "This passkey is already registered",
          });

          return;
        }

        throw insertError;
      }

      await supabase.from("webauthn_challenge").delete().eq("id", challengeId);

      await supabase
        .from("webauthn_pairing")
        .update({
          status: "completed",

          completed_at: now,
        })
        .eq("id", pairingId);

      const sessionToken = createSessionToken(credentialID);

      res.setHeader("Set-Cookie", serializeSessionCookie(sessionToken));

      res.status(200).json({
        verified: true,

        device: {
          id: credentialID,

          deviceName,

          deviceType,
        },
      });

      return;
    }

    /*
     * ==========================================================
     * VAULT RECOVERY — AUTHENTICATION OPTIONS
     * ==========================================================
     *
     * mode:
     *
     * setup
     *   Used when first enabling passkey recovery.
     *
     * reset
     *   Used when recovering an existing vault.
     */

    if (action === "vault-recovery-options") {
      const body = await readJsonBody(req);

      const mode = body.mode === "setup" ? "setup" : "reset";

      let requested = [];

      if (mode === "setup") {
        if (typeof body.prfSalt !== "string" || !body.prfSalt) {
          res.status(400).json({
            error: "PRF salt is required",
          });

          return;
        }
      } else {
        if (!Array.isArray(body.wrappers) || body.wrappers.length === 0) {
          res.status(400).json({
            error: "No recovery passkeys are configured",
          });

          return;
        }

        requested = body.wrappers
          .filter(
            (item) =>
              item &&
              typeof item.credentialId === "string" &&
              typeof item.prfSalt === "string" &&
              item.credentialId &&
              item.prfSalt,
          )
          .slice(0, 20);
      }

      const { data: credentials, error: credentialsError } = await supabase
        .from("webauthn_credential")
        .select("id, transports")
        .limit(20);

      if (credentialsError) {
        throw credentialsError;
      }

      const byId = new Map((credentials || []).map((item) => [item.id, item]));

      /*
       * For recovery, only use passkeys
       * that are still registered.
       */
      if (mode === "reset") {
        requested = requested.filter((item) => byId.has(item.credentialId));

        if (requested.length === 0) {
          res.status(400).json({
            error: "None of your recovery passkeys are currently registered",
          });

          return;
        }
      }

      const challenge = crypto.randomBytes(32).toString("base64url");

      const evalByCredential = {};

      if (mode === "setup") {
        const saltBytes = Buffer.from(body.prfSalt, "base64url");

        for (const credential of credentials || []) {
          evalByCredential[credential.id] = {
            first: isoBase64URL.fromBuffer(saltBytes),
          };
        }
      } else {
        for (const item of requested) {
          const saltBytes = Buffer.from(item.prfSalt, "base64");

          evalByCredential[item.credentialId] = {
            first: isoBase64URL.fromBuffer(saltBytes),
          };
        }
      }

      const allowedIds =
        mode === "setup"
          ? (credentials || []).map((item) => item.id)
          : requested.map((item) => item.credentialId);

      const allowCredentials = allowedIds
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((credential) => ({
          id: credential.id,

          transports: credential.transports
            ? credential.transports.split(",")
            : undefined,
        }));

      const options = await generateAuthenticationOptions({
        rpID: RP_ID,

        userVerification: "required",

        allowCredentials,

        extensions: {
          prf: {
            evalByCredential,
          },
        },
      });

      /*
       * Store the challenge only on the
       * server. Never trust a client-supplied
       * challenge.
       */
      const challengePayload = JSON.stringify({
        challenge: options.challenge,

        mode,

        credentialIds: allowedIds,
      });

      const { error: challengeError } = await supabase
        .from("webauthn_challenge")
        .upsert({
          id: "vault-recovery",

          challenge: challengePayload,

          updated_at: new Date().toISOString(),
        });

      if (challengeError) {
        throw challengeError;
      }

      res.status(200).json(options);

      return;
    }

    /*
     * ==========================================================
     * VAULT RECOVERY — VERIFY PASSKEY
     * ==========================================================
     */

    if (action === "vault-recovery-verify") {
      const body = await readJsonBody(req);

      const response = body.response;

      if (!response || typeof response.id !== "string") {
        res.status(400).json({
          error: "Invalid passkey response",
        });

        return;
      }

      const { data: challengeRow, error: challengeError } = await supabase
        .from("webauthn_challenge")
        .select("challenge")
        .eq("id", "vault-recovery")
        .maybeSingle();

      if (challengeError) {
        throw challengeError;
      }

      if (!challengeRow) {
        res.status(400).json({
          error: "No pending recovery challenge",
        });

        return;
      }

      let saved;

      try {
        saved = JSON.parse(challengeRow.challenge);
      } catch {
        res.status(400).json({
          error: "Invalid recovery challenge",
        });

        return;
      }

      if (
        !Array.isArray(saved.credentialIds) ||
        !saved.credentialIds.includes(response.id)
      ) {
        res.status(403).json({
          error: "This passkey is not authorized for vault recovery",
        });

        return;
      }

      const { data: credential, error: credentialError } = await supabase
        .from("webauthn_credential")
        .select("*")
        .eq("id", response.id)
        .maybeSingle();

      if (credentialError) {
        throw credentialError;
      }

      if (!credential) {
        res.status(404).json({
          error: "Passkey is no longer registered",
        });

        return;
      }

      const verification = await verifyAuthenticationResponse({
        response,

        expectedChallenge: saved.challenge,

        expectedOrigin: ORIGIN,

        expectedRPID: RP_ID,

        requireUserVerification: true,

        authenticator: {
          credentialID: credential.id,

          credentialPublicKey: Buffer.from(credential.public_key, "base64"),

          counter: credential.counter,

          transports: credential.transports
            ? credential.transports.split(",")
            : undefined,
        },
      });

      if (!verification.verified) {
        res.status(400).json({
          error: "Passkey verification failed",
        });

        return;
      }

      const { error: updateError } = await supabase
        .from("webauthn_credential")
        .update({
          counter: verification.authenticationInfo.newCounter,

          last_used_at: new Date().toISOString(),
        })
        .eq("id", credential.id);

      if (updateError) {
        throw updateError;
      }

      await supabase
        .from("webauthn_challenge")
        .delete()
        .eq("id", "vault-recovery");

      res.status(200).json({
        verified: true,

        credentialId: credential.id,
      });

      return;
    }

    /*
     * ==========================================================
     * UNKNOWN ACTION
     * ==========================================================
     */

    res.status(400).json({
      error: "Unknown pairing action",
    });
  } catch (error) {
    console.error("pair.js:", error);

    res.status(500).json({
      error: error.message || "Pairing operation failed",
    });
  }
}
