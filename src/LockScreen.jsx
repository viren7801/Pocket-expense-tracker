import React, { useState, useEffect, useCallback, useRef } from "react";

import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";

import {
  Fingerprint,
  LogOut,
  Plus,
  X,
  ShieldCheck,
  Settings,
  Monitor,
  Smartphone,
  KeyRound,
  Trash2,
  ChevronRight,
  Link2,
  Copy,
  Check,
  RefreshCw,
} from "lucide-react";

/*
 * ============================================================
 * STORAGE KEYS
 * ============================================================
 */

const TAB_SESSION_KEY = "ledger_tab_session";

const DEVICE_REGISTERED_KEY = "ledger_device_registered";

const CURRENT_DEVICE_KEY = "ledger_current_device";

/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function formatDate(value) {
  if (!value) {
    return "unknown";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return "unknown";
  }
}

function formatTimeRemaining(value) {
  if (!value) {
    return "";
  }

  const remaining = new Date(value).getTime() - Date.now();

  if (remaining <= 0) {
    return "Expired";
  }

  const totalSeconds = Math.floor(remaining / 1000);

  const minutes = Math.floor(totalSeconds / 60);

  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/*
 * ============================================================
 * COMPONENT
 * ============================================================
 */

export default function LockScreen({ children }) {
  const isDevelopment = import.meta.env.DEV;

  /*
   * ==========================================================
   * GENERAL AUTH STATE
   * ==========================================================
   */

  const [status, setStatus] = useState(null);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState(null);

  const [setupCode, setSetupCode] = useState("");

  const [hasLocalPasskey, setHasLocalPasskey] = useState(
    () => window.localStorage.getItem(DEVICE_REGISTERED_KEY) === "1",
  );

  /*
   * ==========================================================
   * ACCOUNT / DEVICE MANAGEMENT
   * ==========================================================
   */

  const [showAccountMenu, setShowAccountMenu] = useState(false);

  const [showDevices, setShowDevices] = useState(false);

  const [showAddDevice, setShowAddDevice] = useState(false);

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const [devices, setDevices] = useState([]);

  const [deviceName, setDeviceName] = useState("");

  const [deviceType, setDeviceType] = useState("Touch ID / Face ID");

  const [deviceToRevoke, setDeviceToRevoke] = useState(null);

  const [deviceLoading, setDeviceLoading] = useState(false);

  const [deviceError, setDeviceError] = useState(null);

  /*
   * ==========================================================
   * PAIRING STATE
   * ==========================================================
   */

  const [showPairMenu, setShowPairMenu] = useState(false);

  const [pairMode, setPairMode] = useState(null);
  /*
   * null
   * "trusted"
   * "new"
   */

  const [pairDeviceName, setPairDeviceName] = useState("");

  const [pairDeviceType, setPairDeviceType] = useState("Fingerprint / Face ID");

  const [pairingId, setPairingId] = useState("");

  const [pairingCode, setPairingCode] = useState("");

  const [pairingSecret, setPairingSecret] = useState("");

  const [pairingExpiresAt, setPairingExpiresAt] = useState(null);

  const [pairingStatus, setPairingStatus] = useState("");

  const [pairingError, setPairingError] = useState(null);

  const [copiedPairingCode, setCopiedPairingCode] = useState(false);

  const pairingPollRef = useRef(null);

  /*
   * ==========================================================
   * AUTH STATUS
   * ==========================================================
   */

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/status");

      const data = await res.json();

      /*
       * Don't let an existing cookie
       * automatically unlock a new tab.
       */
      if (
        data.authenticated &&
        !window.sessionStorage.getItem(TAB_SESSION_KEY)
      ) {
        await fetch("/api/auth/logout", {
          method: "POST",
        });

        setStatus({
          authenticated: false,
          hasCredential: data.hasCredential,
        });

        return;
      }

      setStatus(data);
    } catch {
      setStatus({
        authenticated: false,
        hasCredential: false,
      });
    }
  }, []);

  useEffect(() => {
    /*
     * Localhost is a UI development
     * environment.
     *
     * Real WebAuthn is only used in
     * production.
     */
    if (isDevelopment) {
      setStatus({
        authenticated: true,
        hasCredential: true,
      });

      return;
    }

    checkStatus();
  }, [checkStatus, isDevelopment]);

  /*
   * ==========================================================
   * LOGIN
   * ==========================================================
   */

  const handleUnlock = async () => {
    setLoading(true);
    setError(null);

    try {
      const optionsRes = await fetch("/api/auth/login-options");

      const options = await optionsRes.json();

      if (!optionsRes.ok) {
        throw new Error(options.error || "Could not start unlock");
      }

      const authResp = await startAuthentication(options);

      const verifyRes = await fetch("/api/auth/login-verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(authResp),
      });

      const verifyData = await verifyRes.json();

      /*
       * Handle a passkey that has
       * been revoked on the server
       * but still exists locally.
       */
      if (!verifyRes.ok || !verifyData.verified) {
        if (
          verifyRes.status === 404 &&
          verifyData.code === "CREDENTIAL_NOT_REGISTERED"
        ) {
          /*
           * Tell supported authenticators
           * that this credential is no longer
           * accepted by Pocket.
           */
          if (window.PublicKeyCredential?.signalUnknownCredential) {
            try {
              await window.PublicKeyCredential.signalUnknownCredential({
                rpId: "pocket.patelviren.com",
                credentialId: authResp.id,
              });
            } catch {
              /*
               * Signal support varies by platform.
               * This must never prevent the
               * server from rejecting the credential.
               */
            }
          }

          throw new Error(
            "This passkey was revoked. Use another trusted device to register this device again.",
          );
        }

        throw new Error(verifyData.error || "Unlock failed");
      }

      /*
       * Mark this browser tab as
       * authenticated.
       */
      window.sessionStorage.setItem(TAB_SESSION_KEY, "1");

      /*
       * Remember the credential that
       * authenticated the session.
       */
      if (verifyData.device?.id) {
        window.localStorage.setItem(CURRENT_DEVICE_KEY, verifyData.device.id);
      } else if (authResp.id) {
        window.localStorage.setItem(CURRENT_DEVICE_KEY, authResp.id);
      }

      /*
       * QR/phone cross-device authentication
       * may not mean that the current device
       * has a platform passkey yet.
       */
      if (authResp.authenticatorAttachment !== "platform" && !hasLocalPasskey) {
        setPairDeviceName("");
        setPairingError(null);
        setShowAddDevice(true);
      }

      await checkStatus();
    } catch (e) {
      setError(
        e.message === "The operation either timed out or was not allowed."
          ? "Cancelled."
          : e.message || "Unlock failed",
      );
    } finally {
      setLoading(false);
    }
  };

  /*
   * ==========================================================
   * ADD DEVICE
   * ==========================================================
   */

  const handleRegisterDevice = async (includeSetupCode = false) => {
    if (!deviceName.trim()) {
      setDeviceError("Enter a name for this device.");

      return;
    }

    /*
     * Localhost is UI-only.
     */
    if (isDevelopment) {
      setDeviceError("Device registration will work on pocket.patelviren.com.");

      return;
    }

    setLoading(true);
    setDeviceError(null);

    try {
      const optionsRes = await fetch("/api/auth/register-options", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          includeSetupCode
            ? {
                setupCode,
              }
            : {},
        ),
      });

      const options = await optionsRes.json();

      if (!optionsRes.ok) {
        throw new Error(options.error || "Could not start setup");
      }

      const regResp = await startRegistration(options);

      const verifyRes = await fetch("/api/auth/register-verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...regResp,
          deviceName: deviceName.trim(),
          deviceType,
        }),
      });

      const verifyData = await verifyRes.json();

      if (!verifyRes.ok || !verifyData.verified) {
        throw new Error(verifyData.error || "Device registration failed");
      }

      window.sessionStorage.setItem(TAB_SESSION_KEY, "1");

      window.localStorage.setItem(DEVICE_REGISTERED_KEY, "1");

      if (verifyData.device?.id) {
        window.localStorage.setItem(CURRENT_DEVICE_KEY, verifyData.device.id);
      }

      setHasLocalPasskey(true);

      setShowAddDevice(false);

      setDeviceName("");

      setDeviceType("Touch ID / Face ID");

      setDeviceError(null);

      await checkStatus();
    } catch (e) {
      setDeviceError(e.message || "Device registration failed");
    } finally {
      setLoading(false);
    }
  };

  /*
   * ==========================================================
   * LOAD DEVICES
   * ==========================================================
   */

  const loadDevices = async () => {
    setDeviceLoading(true);
    setDeviceError(null);

    try {
      const res = await fetch("/api/auth/devices");

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Could not load devices");
      }

      setDevices(data.devices || []);
    } catch (e) {
      setDeviceError(e.message || "Could not load devices");
    } finally {
      setDeviceLoading(false);
    }
  };

  const openDevices = async () => {
    setShowAccountMenu(false);
    setShowDevices(true);

    await loadDevices();
  };

  /*
   * ==========================================================
   * REVOKE DEVICE
   * ==========================================================
   */

  const handleRevokeDevice = async () => {
    if (!deviceToRevoke) {
      return;
    }

    setDeviceLoading(true);
    setDeviceError(null);

    try {
      const res = await fetch("/api/auth/revoke-device", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: deviceToRevoke.id,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Could not revoke device");
      }

      setDeviceToRevoke(null);

      await loadDevices();
    } catch (e) {
      setDeviceError(e.message || "Could not revoke device");
    } finally {
      setDeviceLoading(false);
    }
  };

  /*
   * ==========================================================
   * LOGOUT
   * ==========================================================
   */

  const handleLogout = async () => {
    setLoading(true);
    setError(null);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });

      window.sessionStorage.removeItem(TAB_SESSION_KEY);

      window.localStorage.removeItem(CURRENT_DEVICE_KEY);

      setShowLogoutConfirm(false);
      setShowAccountMenu(false);
      setShowDevices(false);
      setShowAddDevice(false);

      /*
       * Development is UI-only.
       */
      if (isDevelopment) {
        window.location.reload();
        return;
      }

      await checkStatus();
    } catch {
      setError("Could not log out");
    } finally {
      setLoading(false);
    }
  };

  /*
   * ==========================================================
   * START PAIRING — TRUSTED DEVICE
   * ==========================================================
   */

  const startPairing = async () => {
    if (!pairDeviceName.trim()) {
      setPairingError("Enter a name for the new device.");

      return;
    }

    if (isDevelopment) {
      setPairingError("Device pairing is available on pocket.patelviren.com.");

      return;
    }

    setPairingError(null);
    setPairingStatus("creating");

    try {
      const res = await fetch("/api/auth/pair?action=start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deviceName: pairDeviceName.trim(),
          deviceType: pairDeviceType,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Could not start device pairing");
      }

      setPairingId(data.pairingId);

      setPairingCode(data.code);

      /*
       * The new-device secret is generated
       * after the new device claims the code.
       *
       * Trusted device keeps the pairing
       * information only in memory.
       */
      setPairingSecret(data.secret || "");

      setPairingExpiresAt(data.expiresAt);

      setPairingStatus("waiting");
    } catch (e) {
      setPairingError(e.message || "Could not start pairing");

      setPairingStatus("");
    }
  };

  /*
   * ==========================================================
   * POLL PAIRING — TRUSTED DEVICE
   * ==========================================================
   */

  const pollPairingStatus = useCallback(async () => {
    if (!pairingId) {
      return;
    }

    try {
      const res = await fetch("/api/auth/pair?action=status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pairingId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        return;
      }

      if (data.status === "pending_approval") {
        setPairingStatus("pending_approval");
      }

      if (data.status === "approved") {
        setPairingStatus("approved");
      }

      if (data.status === "completed") {
        setPairingStatus("completed");

        if (pairingPollRef.current) {
          clearInterval(pairingPollRef.current);

          pairingPollRef.current = null;
        }
      }
    } catch {
      /*
       * Polling failures are transient.
       */
    }
  }, [pairingId]);

  useEffect(() => {
    if (
      pairMode !== "trusted" ||
      !pairingId ||
      !pairingStatus ||
      pairingStatus === "completed"
    ) {
      return;
    }

    pairingPollRef.current = setInterval(pollPairingStatus, 1500);

    pollPairingStatus();

    return () => {
      if (pairingPollRef.current) {
        clearInterval(pairingPollRef.current);

        pairingPollRef.current = null;
      }
    };
  }, [pairMode, pairingId, pairingStatus, pollPairingStatus]);

  /*
   * ==========================================================
   * APPROVE PAIRING — TRUSTED DEVICE
   * ==========================================================
   */

  const approvePairing = async () => {
    if (!pairingId) {
      return;
    }

    setPairingError(null);
    setPairingStatus("approving");

    try {
      const res = await fetch("/api/auth/pair?action=approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pairingId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Could not approve device");
      }

      setPairingStatus("approved");
    } catch (e) {
      setPairingError(e.message || "Could not approve device");

      setPairingStatus("pending_approval");
    }
  };

  /*
   * ==========================================================
   * CLAIM PAIRING — NEW DEVICE
   * ==========================================================
   */

  const requestPairing = async () => {
    if (!pairingCode.trim()) {
      setPairingError("Enter the pairing code.");

      return;
    }

    if (!pairDeviceName.trim()) {
      setPairingError("Enter a name for this device.");

      return;
    }

    setPairingError(null);
    setPairingStatus("claiming");

    try {
      const res = await fetch("/api/auth/pair?action=request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: pairingCode.trim().replace(/\s/g, "").toUpperCase(),

          deviceName: pairDeviceName.trim(),

          deviceType: pairDeviceType,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Invalid pairing code");
      }

      setPairingId(data.pairingId);

      setPairingSecret(data.secret);

      setPairingExpiresAt(data.expiresAt);

      setPairingStatus("waiting_for_approval");
    } catch (e) {
      setPairingError(e.message || "Could not pair device");

      setPairingStatus("");
    }
  };

  /*
   * ==========================================================
   * POLL PAIRING — NEW DEVICE
   * ==========================================================
   */

  const pollNewDeviceApproval = useCallback(async () => {
    if (!pairingId || !pairingSecret) {
      return;
    }

    try {
      const res = await fetch("/api/auth/pair?action=status", {
        method: "POST",

        cache: "no-store",

        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },

        body: JSON.stringify({
          pairingId,
          secret: pairingSecret,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.debug("Pair status:", data);

        return;
      }

      console.log("PAIRING STATUS:", data.status);

      if (data.status === "approved") {
        setPairingStatus("approved");

        return;
      }

      if (data.status === "completed") {
        setPairingStatus("completed");
      }
    } catch (error) {
      console.debug("Pairing status error:", error);
    }
  }, [pairingId, pairingSecret]);

  useEffect(() => {
    if (
      pairMode !== "new" ||
      pairingStatus !== "waiting_for_approval" ||
      !pairingId ||
      !pairingSecret
    ) {
      return;
    }

    const interval = setInterval(pollNewDeviceApproval, 1000);

    pollNewDeviceApproval();

    return () => {
      clearInterval(interval);
    };
  }, [
    pairMode,
    pairingStatus,
    pairingId,
    pairingSecret,
    pollNewDeviceApproval,
  ]);

  useEffect(() => {
    if (pairMode !== "new" || pairingStatus !== "approved") {
      return;
    }

    /*
     * Give React one frame to render the
     * approved state before opening the
     * platform passkey UI.
     */
    const timer = setTimeout(() => {
      completePairing();
    }, 250);

    return () => {
      clearTimeout(timer);
    };
  }, [pairMode, pairingStatus, completePairing]);

  /*
   * ==========================================================
   * CREATE PASSKEY — NEW DEVICE
   * ==========================================================
   */

  const completePairing = useCallback(async () => {
    if (!pairingId || !pairingSecret) {
      setPairingError("Pairing information is missing.");

      return;
    }

    setPairingError(null);
    setPairingStatus("authenticating");

    try {
      const optionsRes = await fetch("/api/auth/pair?action=options", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pairingId,
          secret: pairingSecret,
        }),
      });

      const options = await optionsRes.json();

      if (!optionsRes.ok) {
        throw new Error(
          options.error || "Could not start passkey registration",
        );
      }

      /*
       * Create the actual passkey
       * on THIS device.
       *
       * On Fold 7 this will normally
       * invoke the platform biometric /
       * passkey UI.
       */
      const regResp = await startRegistration(options);

      setPairingStatus("verifying");

      const verifyRes = await fetch("/api/auth/pair?action=complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pairingId,

          secret: pairingSecret,

          deviceName: pairDeviceName.trim(),

          deviceType: pairDeviceType,

          registration: regResp,
        }),
      });

      const data = await verifyRes.json();

      if (!verifyRes.ok || !data.verified) {
        throw new Error(data.error || "Device registration failed");
      }

      /*
       * The new device is now
       * authenticated.
       */
      window.sessionStorage.setItem(TAB_SESSION_KEY, "1");

      window.localStorage.setItem(DEVICE_REGISTERED_KEY, "1");

      if (data.device?.id) {
        window.localStorage.setItem(CURRENT_DEVICE_KEY, data.device.id);
      }

      setHasLocalPasskey(true);

      setPairingStatus("completed");
    } catch (e) {
      setPairingError(e.message || "Could not complete device pairing");

      setPairingStatus("approved");
    }
  }, [pairingId, pairingSecret, pairDeviceName, pairDeviceType]);

  /*
   * ==========================================================
   * COPY PAIRING CODE
   * ==========================================================
   */

  const copyPairingCode = async () => {
    if (!pairingCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(pairingCode);

      setCopiedPairingCode(true);

      setTimeout(() => {
        setCopiedPairingCode(false);
      }, 1500);
    } catch {
      /*
       * Clipboard permission can be
       * unavailable on some browsers.
       */
    }
  };

  /*
   * ==========================================================
   * RESET PAIRING
   * ==========================================================
   */

  const resetPairing = () => {
    if (pairingPollRef.current) {
      clearInterval(pairingPollRef.current);

      pairingPollRef.current = null;
    }

    setPairMode(null);

    setShowPairMenu(false);

    setPairDeviceName("");

    setPairingId("");

    setPairingCode("");

    setPairingSecret("");

    setPairingExpiresAt(null);

    setPairingStatus("");

    setPairingError(null);

    setCopiedPairingCode(false);
  };

  /*
   * ==========================================================
   * OPEN PAIRING — TRUSTED DEVICE
   * ==========================================================
   */

  const openTrustedPairing = () => {
    setShowAccountMenu(false);

    setShowDevices(false);

    setShowAddDevice(false);

    setPairMode("trusted");

    setPairDeviceName("");

    setPairDeviceType("Fingerprint / Face ID");

    setPairingError(null);

    setPairingStatus("");

    setPairingCode("");

    setPairingId("");

    setPairingSecret("");

    setPairingExpiresAt(null);
  };

  /*
   * ==========================================================
   * OPEN PAIRING — NEW DEVICE
   * ==========================================================
   */

  const openNewDevicePairing = () => {
    setError(null);

    setShowPairMenu(false);

    setPairMode("new");

    setPairDeviceName("");

    setPairDeviceType("Fingerprint / Face ID");

    setPairingCode("");

    setPairingId("");

    setPairingSecret("");

    setPairingExpiresAt(null);

    setPairingStatus("");

    setPairingError(null);
  };

  /*
   * ==========================================================
   * ACCOUNT MENU
   * ==========================================================
   */

  const accountMenu = (
    <>
      {showAccountMenu && (
        <div style={styles.accountMenu}>
          <div style={styles.accountHeader}>
            <div style={styles.avatar}>V</div>

            <div>
              <div style={styles.accountName}>Viren Patel</div>

              <div style={styles.accountSubtitle}>Personal space</div>
            </div>

            <button
              type="button"
              style={styles.closeButton}
              onClick={() => setShowAccountMenu(false)}
            >
              <X size={15} />
            </button>
          </div>

          <div style={styles.divider} />

          <button
            type="button"
            style={styles.menuItem}
            onClick={() => {
              setShowAccountMenu(false);

              setShowAddDevice(true);

              setDeviceError(null);

              setDeviceName("");

              setDeviceType("Touch ID / Face ID");
            }}
          >
            <div style={styles.menuIcon}>
              <Plus size={16} />
            </div>

            <div style={styles.menuText}>
              <div style={styles.menuTitle}>Add new device</div>

              <div style={styles.menuDescription}>Register on this device</div>
            </div>

            <ChevronRight size={15} color="#5F646D" />
          </button>

          <button
            type="button"
            style={styles.menuItem}
            onClick={openTrustedPairing}
          >
            <div style={styles.menuIcon}>
              <Link2 size={16} />
            </div>

            <div style={styles.menuText}>
              <div style={styles.menuTitle}>Pair a new device</div>

              <div style={styles.menuDescription}>
                Add another phone or computer
              </div>
            </div>

            <ChevronRight size={15} color="#5F646D" />
          </button>

          <button type="button" style={styles.menuItem} onClick={openDevices}>
            <div style={styles.menuIcon}>
              <Settings size={16} />
            </div>

            <div style={styles.menuText}>
              <div style={styles.menuTitle}>Manage devices</div>

              <div style={styles.menuDescription}>View and revoke passkeys</div>
            </div>

            <ChevronRight size={15} color="#5F646D" />
          </button>

          <div style={styles.divider} />

          <button
            type="button"
            style={{
              ...styles.menuItem,
              ...styles.logoutItem,
            }}
            onClick={() => setShowLogoutConfirm(true)}
          >
            <div
              style={{
                ...styles.menuIcon,
                ...styles.logoutIcon,
              }}
            >
              <LogOut size={16} />
            </div>

            <div style={styles.menuText}>
              <div style={styles.menuTitle}>Log out</div>

              <div style={styles.menuDescription}>End this session</div>
            </div>
          </button>
        </div>
      )}

      <button
        type="button"
        style={styles.accountButton}
        onClick={() => setShowAccountMenu((value) => !value)}
      >
        <div style={styles.accountButtonAvatar}>V</div>

        <div style={styles.accountButtonText}>
          <div style={styles.accountButtonName}>Viren Patel</div>

          <div style={styles.accountButtonSubtitle}>Personal</div>
        </div>

        <div style={styles.accountButtonChevron}>
          {showAccountMenu ? "⌃" : "⌄"}
        </div>
      </button>
    </>
  );

  /*
   * ==========================================================
   * ADD DEVICE MODAL
   * ==========================================================
   */

  const addDeviceModal = showAddDevice && (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <button
          type="button"
          style={styles.modalClose}
          onClick={() => {
            setShowAddDevice(false);

            setDeviceError(null);
          }}
        >
          <X size={18} />
        </button>

        <div style={styles.modalIcon}>
          <Fingerprint size={28} />
        </div>

        <div style={styles.modalTitle}>Add new device</div>

        <div style={styles.modalDescription}>
          Register a passkey on this device.
        </div>

        <label style={styles.label}>Device name</label>

        <input
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          placeholder="MacBook Pro"
          style={styles.input}
          autoFocus
        />

        <label style={styles.label}>Authentication</label>

        <select
          value={deviceType}
          onChange={(e) => setDeviceType(e.target.value)}
          style={styles.select}
        >
          <option>Touch ID / Face ID</option>

          <option>Fingerprint</option>

          <option>Face ID</option>

          <option>Windows Hello</option>

          <option>Passkey</option>
        </select>

        <div style={styles.securityNotice}>
          <ShieldCheck size={17} />

          <span>Your private passkey never leaves this device.</span>
        </div>

        {isDevelopment && (
          <div style={styles.localNotice}>
            <ShieldCheck size={16} />

            <span>
              You're on localhost. Real registration works on
              <strong> pocket.patelviren.com</strong>.
            </span>
          </div>
        )}

        {deviceError && <div style={styles.modalError}>{deviceError}</div>}

        <button
          type="button"
          style={{
            ...styles.primaryButton,
            opacity: !deviceName.trim() || loading ? 0.5 : 1,
          }}
          disabled={!deviceName.trim() || loading}
          onClick={() => handleRegisterDevice(false)}
        >
          {loading ? "Waiting for authentication…" : "Continue"}
        </button>

        <button
          type="button"
          style={styles.linkButton}
          onClick={() => {
            setShowAddDevice(false);

            openTrustedPairing();
          }}
        >
          <Link2 size={14} />
          Pair another device instead
        </button>
      </div>
    </div>
  );

  /*
   * ==========================================================
   * MANAGE DEVICES
   * ==========================================================
   */

  const devicesModal = showDevices && (
    <div style={styles.overlay}>
      <div
        style={{
          ...styles.modal,
          width: "min(560px, calc(100vw - 40px))",
        }}
      >
        <button
          type="button"
          style={styles.modalClose}
          onClick={() => {
            setShowDevices(false);

            setDeviceError(null);
          }}
        >
          <X size={18} />
        </button>

        <div style={styles.modalIcon}>
          <KeyRound size={27} />
        </div>

        <div style={styles.modalTitle}>Your devices</div>

        <div style={styles.modalDescription}>
          These devices can unlock your Pocket account.
        </div>

        {deviceError && <div style={styles.modalError}>{deviceError}</div>}

        {deviceLoading ? (
          <div style={styles.loadingText}>Loading devices…</div>
        ) : devices.length === 0 ? (
          <div style={styles.emptyState}>No registered devices found.</div>
        ) : (
          <div style={styles.deviceList}>
            {devices.map((device) => {
              const currentDevice =
                window.localStorage.getItem(CURRENT_DEVICE_KEY);

              const isCurrent = currentDevice === device.id;

              const isPhone =
                device.deviceType?.toLowerCase().includes("face") ||
                device.deviceType?.toLowerCase().includes("phone") ||
                device.deviceType?.toLowerCase().includes("fingerprint");

              return (
                <div key={device.id} style={styles.deviceCard}>
                  <div style={styles.deviceIcon}>
                    {isPhone ? <Smartphone size={19} /> : <Monitor size={19} />}
                  </div>

                  <div style={styles.deviceInfo}>
                    <div style={styles.deviceName}>
                      {device.deviceName || "Registered device"}

                      {isCurrent && (
                        <span style={styles.currentBadge}>This device</span>
                      )}
                    </div>

                    <div style={styles.deviceType}>
                      {device.deviceType || "Passkey"}
                    </div>

                    <div style={styles.deviceMeta}>
                      Added {formatDate(device.createdAt)}
                      {" · "}
                      Last used {formatDate(device.lastUsedAt)}
                    </div>
                  </div>

                  {!isCurrent && (
                    <button
                      type="button"
                      style={styles.revokeButton}
                      onClick={() => setDeviceToRevoke(device)}
                    >
                      <Trash2 size={15} />
                      Revoke
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={styles.deviceActions}>
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={() => {
              setShowDevices(false);

              openTrustedPairing();
            }}
          >
            <Link2 size={16} />
            Pair a new device
          </button>

          <button
            type="button"
            style={styles.secondaryButton}
            onClick={loadDevices}
          >
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>
      </div>
    </div>
  );

  /*
   * ==========================================================
   * TRUSTED DEVICE PAIRING MODAL
   * ==========================================================
   */

  const trustedPairingModal = pairMode === "trusted" && (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <button type="button" style={styles.modalClose} onClick={resetPairing}>
          <X size={18} />
        </button>

        <div style={styles.modalIcon}>
          <Link2 size={28} />
        </div>

        <div style={styles.modalTitle}>Pair a new device</div>

        {pairingStatus === "" ? (
          <>
            <div style={styles.modalDescription}>
              Create a secure, one-time pairing code for another phone or
              computer.
            </div>

            <label style={styles.label}>New device name</label>

            <input
              value={pairDeviceName}
              onChange={(e) => setPairDeviceName(e.target.value)}
              placeholder="Galaxy Fold 7"
              style={styles.input}
              autoFocus
            />

            <label style={styles.label}>Authentication</label>

            <select
              value={pairDeviceType}
              onChange={(e) => setPairDeviceType(e.target.value)}
              style={styles.select}
            >
              <option>Fingerprint / Face ID</option>

              <option>Fingerprint</option>

              <option>Face ID</option>

              <option>Windows Hello</option>

              <option>Passkey</option>
            </select>

            {isDevelopment && (
              <div style={styles.localNotice}>
                <ShieldCheck size={16} />

                <span>Real pairing requires pocket.patelviren.com.</span>
              </div>
            )}

            {pairingError && (
              <div style={styles.modalError}>{pairingError}</div>
            )}

            <button
              type="button"
              style={{
                ...styles.primaryButton,
                opacity: !pairDeviceName.trim() || isDevelopment ? 0.5 : 1,
              }}
              disabled={!pairDeviceName.trim() || isDevelopment}
              onClick={startPairing}
            >
              Create pairing code
            </button>
          </>
        ) : pairingStatus === "creating" ? (
          <div style={styles.centerState}>
            <RefreshCw size={25} className="spin" />

            <div style={styles.stateTitle}>Creating secure pairing…</div>
          </div>
        ) : (
          <>
            <div style={styles.modalDescription}>
              On the new device, open Pocket and choose
              <strong> Pair this device</strong>, then enter this code.
            </div>

            <div style={styles.pairCodeCard}>
              <div style={styles.pairCodeLabel}>ONE-TIME PAIRING CODE</div>

              <div style={styles.pairCode}>
                {pairingCode.match(/.{1,5}/g)?.join(" ") || pairingCode}
              </div>

              <button
                type="button"
                style={styles.copyButton}
                onClick={copyPairingCode}
              >
                {copiedPairingCode ? (
                  <>
                    <Check size={14} />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    Copy
                  </>
                )}
              </button>

              {pairingExpiresAt && (
                <div style={styles.codeExpiry}>
                  Expires in {formatTimeRemaining(pairingExpiresAt)}
                </div>
              )}
            </div>

            <div style={styles.pairStatusCard}>
              <div style={styles.statusDot} />

              <div>
                <div style={styles.statusTitle}>
                  {pairingStatus === "pending_approval"
                    ? "New device is waiting for approval"
                    : pairingStatus === "approving"
                      ? "Approving device…"
                      : pairingStatus === "approved"
                        ? "Device approved"
                        : pairingStatus === "completed"
                          ? "Device successfully added"
                          : "Waiting for new device…"}
                </div>

                <div style={styles.statusDescription}>
                  {pairingStatus === "pending_approval"
                    ? "Review the device and approve it below."
                    : pairingStatus === "approved"
                      ? "The new device can now create its Pocket passkey."
                      : pairingStatus === "completed"
                        ? "You can close this window."
                        : "Keep this window open while the other device connects."}
                </div>
              </div>
            </div>

            {pairingStatus === "pending_approval" && (
              <button
                type="button"
                style={styles.primaryButton}
                onClick={approvePairing}
              >
                Approve this device
              </button>
            )}

            {pairingStatus === "completed" && (
              <button
                type="button"
                style={styles.primaryButton}
                onClick={resetPairing}
              >
                Done
              </button>
            )}

            {pairingError && (
              <div style={styles.modalError}>{pairingError}</div>
            )}

            <button
              type="button"
              style={styles.linkButton}
              onClick={resetPairing}
            >
              Cancel pairing
            </button>
          </>
        )}
      </div>
    </div>
  );

  /*
   * ==========================================================
   * NEW DEVICE PAIRING MODAL
   * ==========================================================
   */

  const newDevicePairingModal = pairMode === "new" && (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <button type="button" style={styles.modalClose} onClick={resetPairing}>
          <X size={18} />
        </button>

        <div style={styles.modalIcon}>
          <Link2 size={28} />
        </div>

        <div style={styles.modalTitle}>Pair this device</div>

        {pairingStatus === "" ? (
          <>
            <div style={styles.modalDescription}>
              Use a device that is already trusted by Pocket to authorize this
              device.
            </div>

            <label style={styles.label}>Device name</label>

            <input
              value={pairDeviceName}
              onChange={(e) => setPairDeviceName(e.target.value)}
              placeholder="Galaxy Fold 7"
              style={styles.input}
              autoFocus
            />

            <label style={styles.label}>Authentication</label>

            <select
              value={pairDeviceType}
              onChange={(e) => setPairDeviceType(e.target.value)}
              style={styles.select}
            >
              <option>Fingerprint / Face ID</option>

              <option>Fingerprint</option>

              <option>Face ID</option>

              <option>Windows Hello</option>

              <option>Passkey</option>
            </select>

            <label style={styles.label}>Pairing code</label>

            <input
              value={pairingCode}
              onChange={(e) => setPairingCode(e.target.value)}
              placeholder="7A39C21F5B"
              style={{
                ...styles.input,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
              autoCapitalize="characters"
            />

            {pairingError && (
              <div style={styles.modalError}>{pairingError}</div>
            )}

            <button
              type="button"
              style={{
                ...styles.primaryButton,
                opacity:
                  !pairDeviceName.trim() || !pairingCode.trim() ? 0.5 : 1,
              }}
              disabled={!pairDeviceName.trim() || !pairingCode.trim()}
              onClick={requestPairing}
            >
              Continue
            </button>

            <button
              type="button"
              style={styles.linkButton}
              onClick={() => setPairMode(null)}
            >
              Back
            </button>
          </>
        ) : pairingStatus === "claiming" ? (
          <div style={styles.centerState}>
            <RefreshCw size={25} className="spin" />

            <div style={styles.stateTitle}>Connecting…</div>

            <div style={styles.stateDescription}>
              Contacting your trusted device.
            </div>
          </div>
        ) : pairingStatus === "waiting_for_approval" ? (
          <div style={styles.centerState}>
            <div style={styles.waitingIcon}>
              <Link2 size={25} />
            </div>

            <div style={styles.stateTitle}>Waiting for approval</div>

            <div style={styles.stateDescription}>
              Approve this device on your already trusted Pocket device.
            </div>

            {pairingExpiresAt && (
              <div style={styles.codeExpiry}>
                Expires in {formatTimeRemaining(pairingExpiresAt)}
              </div>
            )}
          </div>
        ) : pairingStatus === "approved" ? (
          <div style={styles.centerState}>
            <div style={styles.successIcon}>
              <Check size={25} />
            </div>

            <div style={styles.stateTitle}>Device approved</div>

            <div style={styles.stateDescription}>
              Now create a new Pocket passkey on this device.
            </div>

            {pairingError && (
              <div style={styles.modalError}>{pairingError}</div>
            )}

            <button
              type="button"
              style={styles.primaryButton}
              onClick={completePairing}
            >
              Create passkey
            </button>
          </div>
        ) : pairingStatus === "authenticating" ||
          pairingStatus === "verifying" ? (
          <div style={styles.centerState}>
            <Fingerprint size={35} color="#C9A455" />

            <div style={styles.stateTitle}>
              {pairingStatus === "authenticating"
                ? "Create your passkey"
                : "Verifying device…"}
            </div>

            <div style={styles.stateDescription}>
              Follow the biometric prompt on this device.
            </div>
          </div>
        ) : pairingStatus === "completed" ? (
          <div style={styles.centerState}>
            <div style={styles.successIcon}>
              <Check size={25} />
            </div>

            <div style={styles.stateTitle}>Device added</div>

            <div style={styles.stateDescription}>
              This device can now unlock Pocket.
            </div>

            <button
              type="button"
              style={styles.primaryButton}
              onClick={() => {
                resetPairing();

                window.location.reload();
              }}
            >
              Continue to Pocket
            </button>
          </div>
        ) : (
          <div style={styles.centerState}>
            <div style={styles.errorIcon}>!</div>

            <div style={styles.stateTitle}>Pairing failed</div>

            <div style={styles.stateDescription}>
              {pairingError || "Something went wrong."}
            </div>

            <button
              type="button"
              style={styles.primaryButton}
              onClick={resetPairing}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );

  /*
   * ==========================================================
   * REVOKE MODAL
   * ==========================================================
   */

  const revokeModal = deviceToRevoke && (
    <div style={styles.overlay}>
      <div style={styles.smallModal}>
        <div style={styles.dangerIcon}>
          <Trash2 size={23} />
        </div>

        <div style={styles.modalTitle}>Revoke device?</div>

        <div style={styles.modalDescription}>
          <strong>{deviceToRevoke.deviceName || "This device"}</strong> will no
          longer be able to unlock Pocket.
        </div>

        <div style={styles.confirmRow}>
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={() => setDeviceToRevoke(null)}
          >
            Cancel
          </button>

          <button
            type="button"
            style={styles.dangerButton}
            onClick={handleRevokeDevice}
            disabled={deviceLoading}
          >
            {deviceLoading ? "Revoking…" : "Revoke device"}
          </button>
        </div>
      </div>
    </div>
  );

  /*
   * ==========================================================
   * LOGOUT MODAL
   * ==========================================================
   */

  const logoutModal = showLogoutConfirm && (
    <div style={styles.overlay}>
      <div style={styles.smallModal}>
        <div style={styles.logoutModalIcon}>
          <LogOut size={23} />
        </div>

        <div style={styles.modalTitle}>Log out?</div>

        <div style={styles.modalDescription}>
          You'll need to authenticate again to access Pocket.
        </div>

        <div style={styles.confirmRow}>
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={() => setShowLogoutConfirm(false)}
          >
            Cancel
          </button>

          <button
            type="button"
            style={styles.dangerButton}
            onClick={handleLogout}
            disabled={loading}
          >
            {loading ? "Logging out…" : "Log out"}
          </button>
        </div>
      </div>
    </div>
  );

  /*
   * ==========================================================
   * LOCALHOST
   * ==========================================================
   */

  if (isDevelopment) {
    return (
      <>
        {children}

        {accountMenu}

        {addDeviceModal}

        {devicesModal}

        {trustedPairingModal}

        {newDevicePairingModal}

        {revokeModal}

        {logoutModal}

        {error && <div style={styles.toast}>{error}</div>}
      </>
    );
  }

  /*
   * ==========================================================
   * PRODUCTION LOADING
   * ==========================================================
   */

  if (status === null) {
    return (
      <div style={styles.lockWrap}>
        <div style={styles.loadingText}>Loading…</div>
      </div>
    );
  }

  /*
   * ==========================================================
   * AUTHENTICATED PRODUCTION
   * ==========================================================
   */

  if (status.authenticated) {
    return (
      <>
        {children}

        {accountMenu}

        {addDeviceModal}

        {devicesModal}

        {trustedPairingModal}

        {newDevicePairingModal}

        {revokeModal}

        {logoutModal}

        {error && <div style={styles.toast}>{error}</div>}
      </>
    );
  }

  /*
   * ==========================================================
   * PRODUCTION LOCK SCREEN
   * ==========================================================
   */

  return (
    <div style={styles.lockWrap}>
      <style>{`
        @import url(
          'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600&family=Inter:wght@400;500&display=swap'
        );

        .spin {
          animation: pocketSpin 1s linear infinite;
        }

        @keyframes pocketSpin {
          from {
            transform: rotate(0deg);
          }

          to {
            transform: rotate(360deg);
          }
        }
      `}</style>

      <div style={styles.lockCard}>
        <Fingerprint size={42} color="#C9A455" />

        <div style={styles.lockTitle}>Pocket</div>

        {status.hasCredential ? (
          <>
            <div style={styles.lockSubtitle}>
              Unlock with your fingerprint, Face ID, or passkey
            </div>

            <button
              type="button"
              style={styles.primaryButton}
              onClick={handleUnlock}
              disabled={loading}
            >
              {loading ? "Waiting…" : "Unlock"}
            </button>

            <button
              type="button"
              style={styles.lockSecondaryButton}
              onClick={openNewDevicePairing}
            >
              <Link2 size={15} />
              Pair this device
            </button>
          </>
        ) : (
          <>
            <div style={styles.lockSubtitle}>
              Set up biometric unlock for this device
            </div>

            <input
              type="password"
              placeholder="Setup code"
              value={setupCode}
              onChange={(e) => setSetupCode(e.target.value)}
              style={styles.input}
            />

            <button
              type="button"
              style={styles.primaryButton}
              onClick={() => {
                setDeviceName("");
                setDeviceError(null);

                setShowAddDevice(true);
              }}
              disabled={loading || !setupCode}
            >
              Set up Face ID / Touch ID
            </button>

            <button
              type="button"
              style={styles.lockSecondaryButton}
              onClick={openNewDevicePairing}
            >
              <Link2 size={15} />
              Pair this device
            </button>
          </>
        )}

        {error && <div style={styles.modalError}>{error}</div>}
      </div>

      {trustedPairingModal}

      {newDevicePairingModal}
    </div>
  );
}

/*
 * ============================================================
 * STYLES
 * ============================================================
 */

const styles = {
  lockWrap: {
    minHeight: "100vh",

    display: "flex",
    alignItems: "center",
    justifyContent: "center",

    background: "#14161B",

    fontFamily: "Inter, sans-serif",

    position: "relative",
  },

  lockCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",

    gap: 14,

    background: "#1A1D24",

    border: "1px solid #2A2E37",

    borderRadius: 16,

    padding: "38px 34px",

    width: 320,

    boxSizing: "border-box",
  },

  lockTitle: {
    fontFamily: "'Space Grotesk', sans-serif",

    fontSize: 22,

    fontWeight: 600,

    color: "#ECEAE3",
  },

  lockSubtitle: {
    color: "#858A93",

    fontSize: 13,

    lineHeight: 1.5,

    textAlign: "center",
  },

  lockSecondaryButton: {
    width: "100%",

    display: "flex",
    alignItems: "center",
    justifyContent: "center",

    gap: 7,

    background: "transparent",

    color: "#858A93",

    border: "1px solid #30343D",

    borderRadius: 8,

    padding: "10px 14px",

    fontSize: 12,

    fontWeight: 500,

    cursor: "pointer",
  },

  loadingText: {
    color: "#858A93",

    fontSize: 13,

    textAlign: "center",

    padding: 20,
  },

  /*
   * ACCOUNT
   */

  accountButton: {
    position: "fixed",

    left: 18,
    bottom: 18,

    zIndex: 1000,

    display: "flex",
    alignItems: "center",

    gap: 10,

    minWidth: 190,

    padding: "9px 11px",

    background: "rgba(24,27,33,0.96)",

    border: "1px solid #2C3038",

    borderRadius: 12,

    color: "#ECEAE3",

    boxShadow: "0 12px 40px rgba(0,0,0,0.32)",

    cursor: "pointer",

    textAlign: "left",

    backdropFilter: "blur(14px)",
  },

  accountButtonAvatar: {
    width: 34,
    height: 34,

    borderRadius: "50%",

    display: "flex",
    alignItems: "center",
    justifyContent: "center",

    background: "#C9A455",

    color: "#14161B",

    fontSize: 13,

    fontWeight: 700,
  },

  accountButtonText: {
    flex: 1,

    minWidth: 0,
  },

  accountButtonName: {
    fontSize: 12,

    fontWeight: 600,
  },

  accountButtonSubtitle: {
    marginTop: 3,

    fontSize: 10,

    color: "#777C85",
  },

  accountButtonChevron: {
    color: "#777C85",

    fontSize: 14,
  },

  /*
   * ACCOUNT MENU
   */

  accountMenu: {
    position: "fixed",

    left: 18,
    bottom: 70,

    zIndex: 1001,

    width: 310,

    background: "rgba(24,27,33,0.98)",

    border: "1px solid #30343D",

    borderRadius: 15,

    padding: 10,

    boxShadow: "0 24px 70px rgba(0,0,0,0.48)",

    backdropFilter: "blur(18px)",
  },

  accountHeader: {
    display: "flex",
    alignItems: "center",

    gap: 10,

    padding: "8px 7px",
  },

  avatar: {
    width: 38,
    height: 38,

    borderRadius: "50%",

    display: "flex",
    alignItems: "center",
    justifyContent: "center",

    background: "#C9A455",

    color: "#14161B",

    fontWeight: 700,

    fontSize: 14,
  },

  accountName: {
    color: "#ECEAE3",

    fontSize: 13,

    fontWeight: 600,
  },

  accountSubtitle: {
    marginTop: 3,

    color: "#6F747D",

    fontSize: 10,
  },

  closeButton: {
    marginLeft: "auto",

    width: 28,
    height: 28,

    display: "flex",
    alignItems: "center",
    justifyContent: "center",

    border: "1px solid #30343D",

    background: "#191C22",

    color: "#777C85",

    borderRadius: 7,

    cursor: "pointer",
  },

  divider: {
    height: 1,

    background: "#292D35",

    margin: "7px 0",
  },

  menuItem: {
    width: "100%",

    display: "flex",
    alignItems: "center",

    gap: 11,

    padding: "11px 8px",

    background: "transparent",

    border: "none",

    borderRadius: 9,

    color: "#ECEAE3",

    cursor: "pointer",

    textAlign: "left",
  },

  logoutItem: {
    marginTop: 2,
  },

  menuIcon: {
    width: 31,
    height: 31,

    display: "flex",
    alignItems: "center",
    justifyContent: "center",

    borderRadius: 8,

    background: "#20242B",

    color: "#C9A455",
  },

  logoutIcon: {
    color: "#D9735C",
  },

  menuText: {
    flex: 1,
  },

  menuTitle: {
    fontSize: 12,

    fontWeight: 500,

    color: "#ECEAE3",
  },

  menuDescription: {
    marginTop: 3,

    fontSize: 10,

    color: "#686D76",
  },

  /*
   * MODALS
   */

  overlay: {
    position: "fixed",

    inset: 0,

    zIndex: 2000,

    display: "flex",
    alignItems: "center",
    justifyContent: "center",

    padding: 20,

    background: "rgba(7,9,11,0.74)",

    backdropFilter: "blur(12px)",
  },

  modal: {
    position: "relative",

    width: "min(450px, calc(100vw - 40px))",

    maxHeight: "calc(100vh - 40px)",

    overflowY: "auto",

    background: "#1A1D24",

    border: "1px solid #30343D",

    borderRadius: 17,

    padding: 28,

    boxShadow: "0 30px 100px rgba(0,0,0,0.55)",

    color: "#ECEAE3",

    boxSizing: "border-box",
  },

  smallModal: {
    width: "min(390px, calc(100vw - 40px))",

    background: "#1A1D24",

    border: "1px solid #30343D",

    borderRadius: 16,

    padding: 26,

    boxShadow: "0 30px 100px rgba(0,0,0,0.55)",

    color: "#ECEAE3",
  },

  modalClose: {
    position: "absolute",

    top: 13,
    right: 13,

    width: 30,
    height: 30,

    display: "flex",
    alignItems: "center",
    justifyContent: "center",

    border: "1px solid #30343D",

    background: "#15181D",

    color: "#777C85",

    borderRadius: 7,

    cursor: "pointer",
  },

  modalIcon: {
    width: 52,
    height: 52,

    display: "flex",
    alignItems: "center",
    justifyContent: "center",

    borderRadius: 13,

    background: "#20241D",

    color: "#C9A455",

    marginBottom: 18,
  },

  modalTitle: {
    fontFamily: "'Space Grotesk', sans-serif",

    fontSize: 22,

    fontWeight: 600,

    marginBottom: 9,
  },

  modalDescription: {
    color: "#858A93",

    fontSize: 13,

    lineHeight: 1.55,

    marginBottom: 18,
  },

  label: {
    display: "block",

    color: "#9A9EA6",

    fontSize: 11,

    fontWeight: 500,

    marginBottom: 7,
  },

  input: {
    width: "100%",

    background: "#14161B",

    border: "1px solid #30343D",

    borderRadius: 8,

    padding: "11px 12px",

    color: "#ECEAE3",

    fontSize: 13,

    boxSizing: "border-box",

    outline: "none",

    marginBottom: 15,
  },

  select: {
    width: "100%",

    background: "#14161B",

    border: "1px solid #30343D",

    borderRadius: 8,

    padding: "11px 12px",

    color: "#ECEAE3",

    fontSize: 13,

    boxSizing: "border-box",

    outline: "none",

    marginBottom: 15,
  },

  securityNotice: {
    display: "flex",
    alignItems: "flex-start",

    gap: 9,

    padding: 12,

    background: "#15191A",

    border: "1px solid #27352D",

    borderRadius: 9,

    color: "#7E9B88",

    fontSize: 11,

    lineHeight: 1.5,

    marginBottom: 12,
  },

  localNotice: {
    display: "flex",
    alignItems: "flex-start",

    gap: 9,

    padding: 12,

    background: "#15181D",

    border: "1px solid #2A2E37",

    borderRadius: 9,

    color: "#8B9099",

    fontSize: 11,

    lineHeight: 1.5,

    marginBottom: 12,
  },

  primaryButton: {
    width: "100%",

    background: "#C9A455",

    color: "#14161B",

    border: "none",

    borderRadius: 8,

    padding: "12px 14px",

    fontSize: 13,

    fontWeight: 600,

    cursor: "pointer",
  },

  secondaryButton: {
    display: "flex",

    alignItems: "center",
    justifyContent: "center",

    gap: 7,

    background: "#20242B",

    color: "#ECEAE3",

    border: "1px solid #30343D",

    borderRadius: 8,

    padding: "11px 14px",

    fontSize: 12,

    fontWeight: 500,

    cursor: "pointer",

    flex: 1,
  },

  deviceActions: {
    display: "flex",

    gap: 9,

    marginTop: 16,
  },

  linkButton: {
    width: "100%",

    display: "flex",
    alignItems: "center",
    justifyContent: "center",

    gap: 6,

    border: "none",

    background: "transparent",

    color: "#777C85",

    padding: "10px",

    fontSize: 11,

    cursor: "pointer",
  },

  dangerButton: {
    background: "#5A2924",

    color: "#F0B5A7",

    border: "1px solid #713B34",

    borderRadius: 8,

    padding: "11px 15px",

    fontSize: 12,

    fontWeight: 600,

    cursor: "pointer",

    flex: 1,
  },

  confirmRow: {
    display: "flex",

    gap: 9,

    marginTop: 20,
  },

  dangerIcon: {
    width: 48,
    height: 48,

    display: "flex",
    alignItems: "center",
    justifyContent: "center",

    borderRadius: 12,

    background: "#33201E",

    color: "#D9735C",

    marginBottom: 16,
  },

  logoutModalIcon: {
    width: 48,
    height: 48,

    display: "flex",
    alignItems: "center",
    justifyContent: "center",

    borderRadius: 12,

    background: "#29251D",

    color: "#C9A455",

    marginBottom: 16,
  },

  modalError: {
    color: "#D9735C",

    background: "rgba(217,115,92,0.08)",

    border: "1px solid rgba(217,115,92,0.18)",

    borderRadius: 8,

    padding: "9px 10px",

    fontSize: 11,

    lineHeight: 1.4,

    marginBottom: 12,
  },

  /*
   * DEVICE LIST
   */

  deviceList: {
    display: "flex",

    flexDirection: "column",

    gap: 8,

    marginTop: 4,
  },

  deviceCard: {
    display: "flex",

    alignItems: "center",

    gap: 11,

    padding: 12,

    background: "#15181D",

    border: "1px solid #2A2E37",

    borderRadius: 11,
  },

  deviceIcon: {
    width: 38,
    height: 38,

    flexShrink: 0,

    display: "flex",
    alignItems: "center",
    justifyContent: "center",

    borderRadius: 9,

    background: "#20242B",

    color: "#C9A455",
  },

  deviceInfo: {
    flex: 1,

    minWidth: 0,
  },

  deviceName: {
    display: "flex",

    alignItems: "center",

    gap: 7,

    color: "#ECEAE3",

    fontSize: 12,

    fontWeight: 600,

    lineHeight: 1.3,
  },

  deviceType: {
    color: "#8A8F98",

    fontSize: 10,

    marginTop: 3,
  },

  deviceMeta: {
    color: "#5F646D",

    fontSize: 9,

    marginTop: 5,
  },

  currentBadge: {
    display: "inline-flex",

    alignItems: "center",

    padding: "2px 6px",

    background: "#203126",

    border: "1px solid #2D4937",

    color: "#70B884",

    borderRadius: 5,

    fontSize: 8,

    fontWeight: 600,

    whiteSpace: "nowrap",
  },

  revokeButton: {
    display: "flex",

    alignItems: "center",

    gap: 5,

    flexShrink: 0,

    background: "transparent",

    border: "1px solid #393039",

    color: "#C77D70",

    borderRadius: 7,

    padding: "7px 8px",

    fontSize: 10,

    cursor: "pointer",
  },

  emptyState: {
    padding: "24px 10px",

    textAlign: "center",

    color: "#6F747D",

    fontSize: 12,
  },

  /*
   * PAIRING
   */

  pairCodeCard: {
    textAlign: "center",

    padding: "22px 15px",

    background: "#15181D",

    border: "1px solid #30343D",

    borderRadius: 13,

    marginBottom: 12,
  },

  pairCodeLabel: {
    color: "#656A73",

    fontSize: 9,

    letterSpacing: "0.12em",

    fontWeight: 600,

    marginBottom: 13,
  },

  pairCode: {
    fontFamily: "'Space Grotesk', sans-serif",

    color: "#ECEAE3",

    fontSize: 27,

    fontWeight: 600,

    letterSpacing: "0.12em",

    marginBottom: 13,
  },

  copyButton: {
    display: "inline-flex",

    alignItems: "center",

    justifyContent: "center",

    gap: 6,

    background: "#20242B",

    color: "#A5A9B0",

    border: "1px solid #30343D",

    borderRadius: 7,

    padding: "7px 11px",

    fontSize: 10,

    cursor: "pointer",
  },

  codeExpiry: {
    color: "#666B74",

    fontSize: 10,

    marginTop: 12,

    textAlign: "center",
  },

  pairStatusCard: {
    display: "flex",

    alignItems: "flex-start",

    gap: 10,

    padding: 12,

    background: "#15181D",

    border: "1px solid #2A2E37",

    borderRadius: 9,

    marginBottom: 14,
  },

  statusDot: {
    width: 8,
    height: 8,

    marginTop: 4,

    flexShrink: 0,

    borderRadius: "50%",

    background: "#C9A455",

    boxShadow: "0 0 0 4px rgba(201,164,85,0.08)",
  },

  statusTitle: {
    color: "#ECEAE3",

    fontSize: 11,

    fontWeight: 600,
  },

  statusDescription: {
    color: "#70757E",

    fontSize: 10,

    lineHeight: 1.45,

    marginTop: 3,
  },

  centerState: {
    minHeight: 220,

    display: "flex",

    flexDirection: "column",

    alignItems: "center",

    justifyContent: "center",

    textAlign: "center",

    gap: 12,
  },

  stateTitle: {
    color: "#ECEAE3",

    fontSize: 14,

    fontWeight: 600,
  },

  stateDescription: {
    color: "#777C85",

    fontSize: 11,

    lineHeight: 1.5,

    maxWidth: 290,
  },

  waitingIcon: {
    width: 52,
    height: 52,

    display: "flex",

    alignItems: "center",

    justifyContent: "center",

    borderRadius: "50%",

    background: "#25251F",

    color: "#C9A455",
  },

  successIcon: {
    width: 52,
    height: 52,

    display: "flex",

    alignItems: "center",

    justifyContent: "center",

    borderRadius: "50%",

    background: "#203126",

    border: "1px solid #2D4937",

    color: "#70B884",
  },

  errorIcon: {
    width: 52,
    height: 52,

    display: "flex",

    alignItems: "center",

    justifyContent: "center",

    borderRadius: "50%",

    background: "#33201E",

    color: "#D9735C",

    fontSize: 23,

    fontWeight: 700,
  },

  /*
   * TOAST
   */

  toast: {
    position: "fixed",

    left: "50%",

    bottom: 22,

    transform: "translateX(-50%)",

    zIndex: 3000,

    background: "#1A1D24",

    border: "1px solid #3A3030",

    borderRadius: 9,

    padding: "10px 14px",

    color: "#D9735C",

    fontSize: 11,

    boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
  },
};
