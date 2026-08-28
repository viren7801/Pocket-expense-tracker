import React, { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";

const TAB_SESSION_KEY = "ledger_tab_session";
const DEVICE_REGISTERED_KEY = "ledger_device_registered";
const CURRENT_DEVICE_KEY = "ledger_current_device";

export default function LockScreen({ children }) {
  const isDevelopment = import.meta.env.DEV;

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [setupCode, setSetupCode] = useState("");

  const [hasLocalPasskey, setHasLocalPasskey] = useState(
    () => window.localStorage.getItem(DEVICE_REGISTERED_KEY) === "1",
  );

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
   * AUTH STATUS
   * ==========================================================
   */

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/status");
      const data = await res.json();

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
     * Localhost intentionally skips WebAuthn.
     * This lets you work on the Pocket UI without
     * production RP-ID restrictions.
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

      if (!verifyRes.ok || !verifyData.verified) {
        throw new Error(verifyData.error || "Unlock failed");
      }

      window.sessionStorage.setItem(TAB_SESSION_KEY, "1");

      /*
       * Remember which credential authenticated
       * this browser. This is used only for UI
       * identification of the current device.
       */
      if (verifyData.device?.id) {
        window.localStorage.setItem(CURRENT_DEVICE_KEY, verifyData.device.id);
      } else if (authResp.id) {
        window.localStorage.setItem(CURRENT_DEVICE_KEY, authResp.id);
      }

      /*
       * A QR/phone authentication may mean that
       * this device doesn't yet have its own
       * platform passkey.
       */
      if (authResp.authenticatorAttachment !== "platform" && !hasLocalPasskey) {
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
     * Localhost is only a UI preview.
     *
     * Real registration must happen on the
     * production RP ID:
     *
     * pocket.patelviren.com
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

      /*
       * Trigger Touch ID / Face ID / passkey.
       */
      const regResp = await startRegistration(options);

      /*
       * Send our friendly device metadata
       * alongside the WebAuthn response.
       */
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
   * LOG OUT
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

      setShowLogoutConfirm(false);
      setShowAccountMenu(false);
      setShowDevices(false);
      setShowAddDevice(false);

      /*
       * On localhost, reload the dashboard
       * because authentication is intentionally
       * bypassed for development.
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
            }}
          >
            <div style={styles.menuIcon}>
              <Plus size={16} />
            </div>

            <div style={styles.menuText}>
              <div style={styles.menuTitle}>Add new device</div>

              <div style={styles.menuDescription}>
                Register Touch ID or Face ID
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
          Give this device a name so you can recognize it later.
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
              You're on localhost. Registration will work on
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
      </div>
    </div>
  );

  /*
   * ==========================================================
   * MANAGE DEVICES MODAL
   * ==========================================================
   */

  const devicesModal = showDevices && (
    <div style={styles.overlay}>
      <div
        style={{
          ...styles.modal,
          width: "min(520px, calc(100vw - 40px))",
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

              return (
                <div key={device.id} style={styles.deviceCard}>
                  <div style={styles.deviceIcon}>
                    {device.deviceType?.toLowerCase().includes("face") ||
                    device.deviceType?.toLowerCase().includes("phone") ? (
                      <Smartphone size={19} />
                    ) : (
                      <Monitor size={19} />
                    )}
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

        <button
          type="button"
          style={styles.secondaryButton}
          onClick={() => {
            setShowDevices(false);
            setShowAddDevice(true);
          }}
        >
          <Plus size={16} />
          Add another device
        </button>
      </div>
    </div>
  );

  /*
   * ==========================================================
   * REVOKE CONFIRMATION
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
   * LOGOUT CONFIRMATION
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
        {revokeModal}
        {logoutModal}
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
        {revokeModal}
        {logoutModal}
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
                handleRegisterDevice(true);
              }}
              disabled={loading || !setupCode}
            >
              {loading ? "Waiting…" : "Set up Face ID / Touch ID"}
            </button>
          </>
        )}

        {error && <div style={styles.modalError}>{error}</div>}
      </div>
    </div>
  );
}

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

  loadingText: {
    color: "#858A93",
    fontSize: 13,
    textAlign: "center",
    padding: 20,
  },

  /*
   * ACCOUNT BUTTON
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

    background: "rgba(24, 27, 33, 0.96)",

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

    width: 300,

    background: "rgba(24, 27, 33, 0.98)",

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
   * MODAL
   */

  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 2000,

    display: "flex",
    alignItems: "center",
    justifyContent: "center",

    padding: 20,

    background: "rgba(7, 9, 11, 0.74)",

    backdropFilter: "blur(12px)",
  },

  modal: {
    position: "relative",

    width: "min(430px, calc(100vw - 40px))",

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
    width: "100%",

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

    marginTop: 16,
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
   * DEVICES
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
   * ERRORS
   */

  error: {
    color: "#D9735C",
    fontSize: 12,
    textAlign: "center",
  },
};
