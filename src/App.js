import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { toast } from "react-toastify";
import axios from "axios";
import TwilioDialer from "./TwilioDialer";
import {
  FiPhone,
  FiUsers,
  FiSettings,
  FiLogOut,
  FiSearch,
  FiClock,
  FiShield,
  FiAlertCircle,
  FiCheck,
} from "react-icons/fi";

import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";

const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [registerName, setRegisterName] = useState("");
  const [currentView, setCurrentView] = useState(() => {
    const path = window.location.pathname.replace(/^\//, "");
    if (["dashboard", "contacts", "dialer", "callHistory"].includes(path)) {
      return path;
    }
    return "dashboard";
  });
  const [authState, setAuthState] = useState("initial");
  const [authMessage, setAuthMessage] = useState("");
  const [isWebAuthnSupported, setIsWebAuthnSupported] = useState(false);
  const [hasPasskey, setHasPasskey] = useState(false);
  // const API_BASE_URL = "http://localhost:8000/api";
  const API_BASE_URL = "https://dialmate-backend.onrender.com/api";
  const [user, setUser] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "🏠" },
    { id: "contacts", label: "Contacts", icon: "👥" },
    { id: "dialer", label: "Dialer", icon: "📞" },
  ];

  const [contacts, setContacts] = useState([]);
  const [showContactModal, setShowContactModal] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [callState, setCallState] = useState("idle");
  const [dialNumber, setDialNumber] = useState("");
  const [callStatusMsg, setCallStatusMsg] = useState("");
  const [callHistory, setCallHistory] = useState([]);

  const fetchCallHistory = async () => {
    try {
      const token = localStorage.getItem("access");
      if (!token) return;
      const response = await fetch(`${API_BASE_URL}/call-history/`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) throw new Error("Failed to fetch call history");
      const data = await response.json();
      const mapped = data.map((call) => ({
        number: call.phone_number,
        name: call.contact_name || "Unknown",
        status: call.status === "ended" ? "completed" : call.status,
        time: call.started_at,
        duration: call.duration,
      }));
      setCallHistory(mapped);
    } catch (err) {
    }
  };
  const navigate = useNavigate();

  const fetchContacts = async () => {
    const token = localStorage.getItem("access");
    if (!token) {
      setIsAuthenticated(false);
      setUser(null);
      return;
    }
    try {
      const response = await axios.get(`${API_BASE_URL}/get_contacts/`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      setContacts(response.data);
    } catch (error) {
      if (error.response && error.response.status === 401) {
        localStorage.removeItem("access");
        localStorage.removeItem("refresh");
        setIsAuthenticated(false);
        setUser(null);
        toast.error("Session expired. Please log in again.");
        navigate("/");
      } else {
      }
    }
  };

  useEffect(() => {
    setIsWebAuthnSupported(browserSupportsWebAuthn());
    const registeredUser = localStorage.getItem("passkeyRegistered");
    setHasPasskey(!!registeredUser);
    const access = localStorage.getItem("access");
    const refresh = localStorage.getItem("refresh");
    if (access && refresh) {
      checkAuthStatus();
    } else {
      setIsAuthenticated(false);
      setUser(null);
    }
    const handlePop = () => {
      const path = window.location.pathname.replace(/^\//, "");
      if (["dashboard", "contacts", "dialer", "callHistory"].includes(path)) {
        setCurrentView(path);
      }
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);
  const goToView = (view) => {
    setCurrentView(view);
    navigate(`/${view}`);
  };

  const apiCall = async (endpoint, options = {}) => {
    const url = `${API_BASE_URL}${endpoint}`;
    const config = {
      headers: {
        "Content-Type": "application/json",
      },
      ...options,
    };

    const response = await fetch(url, config);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "API request failed");
    }

    return data;
  };

  const base64urlToUint8Array = (base64url) => {
    const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "="
    );
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  };

  const uint8ArrayToBase64url = (uint8Array) => {
    const base64 = btoa(String.fromCharCode(...uint8Array));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  };

  const handleRegisterPasskey = async () => {
    if (!window.PublicKeyCredential) {
      setAuthMessage("WebAuthn is not supported on this device");
      setAuthState("error");
      return;
    }

    if (!registerName) {
      setAuthMessage("Please enter a name to register a passkey.");
      setAuthState("error");
      return;
    }

    try {
      setAuthState("registering");
      setAuthMessage("Starting passkey registration...");

      const beginResponse = await apiCall("/auth/register-begin/", {
        method: "POST",
        body: JSON.stringify({
          username: registerName,
          display_name: registerName,
        }),
      });

      if (beginResponse.status !== "success") {
        throw new Error(beginResponse.message);
      }

      setAuthMessage("Please follow the prompts to create your passkey...");

      const options = beginResponse.options;
      const credentialCreationOptions = {
        publicKey: {
          challenge: base64urlToUint8Array(options.challenge),
          rp: options.rp,
          user: {
            id: base64urlToUint8Array(options.user.id),
            name: options.user.name,
            displayName: options.user.displayName,
          },
          pubKeyCredParams: options.pubKeyCredParams,
          timeout: options.timeout,
          attestation: options.attestation,
          authenticatorSelection: options.authenticatorSelection,
        },
      };

      const credential = await navigator.credentials.create(
        credentialCreationOptions
      );

      if (!credential) throw new Error("Failed to create credential");

      const registrationData = {
        id: credential.id,
        rawId: uint8ArrayToBase64url(new Uint8Array(credential.rawId)),
        type: credential.type,
        response: {
          clientDataJSON: uint8ArrayToBase64url(
            new Uint8Array(credential.response.clientDataJSON)
          ),
          attestationObject: uint8ArrayToBase64url(
            new Uint8Array(credential.response.attestationObject)
          ),
        },
        // Pass the challenge from the begin step for stateless backend
        challenge: options.challenge,
        user: options.user, // Ensure user object is sent for backend
      };

      if (credential.authenticatorAttachment) {
        registrationData.authenticatorAttachment =
          credential.authenticatorAttachment;
      }

      const completeResponse = await apiCall("/auth/register-complete/", {
        method: "POST",
        body: JSON.stringify(registrationData),
      });

      if (completeResponse.status === "success") {
        setHasPasskey(true);
        setAuthState("initial");
        setAuthMessage("Passkey created successfully! You can now sign in.");
        localStorage.setItem("username", registerName);
      } else {
        throw new Error(completeResponse.message);
      }
    } catch (error) {
      setAuthState("error");
      if (error.name === "InvalidStateError") {
        setAuthMessage(
          "A passkey already exists for this device. Try signing in instead."
        );
      } else if (error.name === "NotAllowedError") {
        setAuthMessage("Passkey creation was cancelled or not allowed.");
      } else if (error.name === "AbortError") {
        setAuthMessage("Passkey creation timed out. Please try again.");
      } else {
        setAuthMessage(
          `Failed to create passkey: ${error.message || "Unknown error"}`
        );
      }
    }
  };

  const handleAuthenticatePasskey = async () => {
    if (!window.PublicKeyCredential) {
      setAuthMessage("WebAuthn is not supported on this device");
      setAuthState("error");
      return;
    }

    try {
      setAuthState("authenticating");
      setAuthMessage("Starting authentication...");
      const beginResponse = await apiCall("/auth/login-begin/", {
        method: "POST",
        body: JSON.stringify({}),
      });

      if (beginResponse.status !== "success") {
        throw new Error(beginResponse.message);
      }

      setAuthMessage("Please verify your identity...");
      const options = beginResponse.options;

      const credentialRequestOptions = {
        publicKey: {
          challenge: base64urlToUint8Array(options.challenge),
          timeout: options.timeout,
          rpId: options.rpId,
          userVerification: options.userVerification,
          allowCredentials: options.allowCredentials?.map((cred) => ({
            ...cred,
            id: base64urlToUint8Array(cred.id),
          })),
        },
      };

      const credential = await navigator.credentials.get(
        credentialRequestOptions
      );

      if (!credential) {
        throw new Error("Failed to get credential");
      }

      const authenticationData = {
        id: credential.id,
        rawId: uint8ArrayToBase64url(new Uint8Array(credential.rawId)),
        type: credential.type,
        response: {
          clientDataJSON: uint8ArrayToBase64url(
            new Uint8Array(credential.response.clientDataJSON)
          ),
          authenticatorData: uint8ArrayToBase64url(
            new Uint8Array(credential.response.authenticatorData)
          ),
          signature: uint8ArrayToBase64url(
            new Uint8Array(credential.response.signature)
          ),
          userHandle: credential.response.userHandle
            ? uint8ArrayToBase64url(
                new Uint8Array(credential.response.userHandle)
              )
            : null,
        },
        authenticatorAttachment: credential.authenticatorAttachment,
        // Pass the challenge from the begin step for stateless backend
        challenge: options.challenge,
      };

      const completeResponse = await apiCall("/auth/login-complete/", {
        method: "POST",
        body: JSON.stringify(authenticationData),
      });

      if (completeResponse.status === "success") {
        localStorage.setItem("access", completeResponse.access);
        localStorage.setItem("refresh", completeResponse.refresh);

        setIsAuthenticated(true);
        setUser(completeResponse.user);
        setAuthState("initial");
        setAuthMessage("");
        setCurrentView("dashboard");

        navigate("/dashboard");
      } else {
        throw new Error(completeResponse.message);
      }
    } catch (error) {
      setAuthState("error");
      if (error.name === "NotAllowedError") {
        setAuthMessage("Authentication was cancelled or failed.");
      } else if (error.name === "AbortError") {
        setAuthMessage("Authentication timed out. Please try again.");
      } else {
        setAuthMessage(
          `Authentication failed: ${error.message || "Unknown error"}`
        );
      }
    }
  };

  const resetAuthState = () => {
    setAuthState("initial");
    setAuthMessage("");
  };

  const handleLogout = async () => {
    try {
      const access = localStorage.getItem("access");
      const refresh = localStorage.getItem("refresh");

      if (!refresh || !access) {
        toast.error("Tokens missing");
        return;
      }

      const response = await fetch(`${API_BASE_URL}/auth/logout/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access}`,
        },
        body: JSON.stringify({ refresh }),
      });

      const result = await response.json();

      if (response.ok && result.status === "success") {
        localStorage.removeItem("access");
        localStorage.removeItem("refresh");

        setUser(null);
        setIsAuthenticated(false);

        toast.success("Logged out successfully");
        navigate("/");
      } else {
        toast.error(result.message || "Logout failed");
      }
    } catch (error) {
      toast.error("Logout failed");
    }
  };

  const resetPasskey = () => {
    setHasPasskey(false);
    resetAuthState();
    setAuthMessage("You can now register a new passkey.");
  };

  useEffect(() => {
    checkAuthStatus();
    checkPasskeyAvailability();
  }, []);

  useEffect(() => {
    if (isAuthenticated && localStorage.getItem("access")) {
      fetchContacts();
      fetchCallHistory();
    } else {
      setCallHistory([]);
    }
  }, [isAuthenticated]);

  const checkAuthStatus = async () => {
    try {
      const access = localStorage.getItem("access");
      if (!access) {
        setIsAuthenticated(false);
        setUser(null);
        setCurrentView("dashboard");
        if (window.location.pathname !== "/") {
          navigate("/");
        }
        return;
      }
      const response = await apiCall("/auth/status/", {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access}`,
        },
      });
      if (response.authenticated) {
        setIsAuthenticated(true);
        setUser(response.user);

        const path = window.location.pathname.replace(/^\//, "");
        const validViews = ["dashboard", "contacts", "dialer", "callHistory"];

        if (validViews.includes(path)) {
          setCurrentView(path);
        } else {
          setCurrentView("dashboard");
          navigate("/dashboard");
        }
      }
    } catch (error) {
      setIsAuthenticated(false);
      setUser(null);
      setCurrentView("dashboard");
      if (window.location.pathname !== "/") {
        navigate("/");
      }
    }
  };

  const checkPasskeyAvailability = () => {
    if (window.PublicKeyCredential) {
      setHasPasskey(true);
    }
  };

  const LoginPage = () => (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 to-blue-100 flex items-center justify-center p-4">
      <div className="bg-white/80 backdrop-blur-lg rounded-2xl shadow-lg p-6 w-full max-w-md border border-gray-200">
        <div className="text-center mb-6">
          <div className="mx-auto w-16 h-16 bg-blue-600 rounded-xl flex items-center justify-center mb-4 shadow-md">
            <FiShield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-800">Welcome Back</h1>
          <p className="text-gray-600 text-sm mt-1">
            Sign in securely with your passkey
          </p>
        </div>
        {!hasPasskey && (
          <div className="mb-4">
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700"
            >
              Name for Passkey
            </label>
            <input
              type="text"
              id="name"
              value={registerName}
              onChange={(e) => setRegisterName(e.target.value)}
              placeholder="Enter your name"
              className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring focus:border-blue-300 text-gray-900"
            />
          </div>
        )}

        {authMessage && (
          <div
            className={`mb-5 p-3 rounded-md text-sm border ${
              authState === "error"
                ? "bg-red-50 border-red-200 text-red-600"
                : authState === "registering" || authState === "authenticating"
                ? "bg-blue-50 border-blue-200 text-blue-600"
                : "bg-green-50 border-green-200 text-green-600"
            }`}
          >
            <div className="flex items-center gap-2">
              {authState === "error" && <FiAlertCircle className="w-4 h-4" />}
              {(authState === "registering" ||
                authState === "authenticating") && (
                <div className="w-4 h-4 animate-spin border-2 border-b-transparent border-current rounded-full"></div>
              )}
              {authState === "initial" && authMessage.includes("success") && (
                <FiCheck className="w-4 h-4" />
              )}
              <span>{authMessage}</span>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {hasPasskey ? (
            <button
              onClick={handleAuthenticatePasskey}
              disabled={authState === "authenticating"}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium py-3 px-4 rounded-lg transition"
            >
              {authState === "authenticating" ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Authenticating...</span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <FiShield className="w-4 h-4" />
                  <span>Sign in with Passkey</span>
                </div>
              )}
            </button>
          ) : (
            <button
              onClick={handleRegisterPasskey}
              disabled={authState === "registering"}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium py-3 px-4 rounded-lg transition"
            >
              {authState === "registering" ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Creating Passkey...</span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <FiShield className="w-4 h-4" />
                  <span>Create Passkey</span>
                </div>
              )}
            </button>
          )}

          {hasPasskey && authState === "initial" && (
            <button
              onClick={resetPasskey}
              className="w-full text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 py-2 rounded-md transition"
            >
              Click here to create Passkey
            </button>
          )}

          {authState === "error" && (
            <button
              onClick={resetAuthState}
              className="w-full text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 py-2 rounded-md transition"
            >
              Try Again
            </button>
          )}
        </div>

        <div className="mt-6 bg-white border border-gray-100 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-800 mb-2">
            🔒 About Passkeys
          </h3>
          <ul className="text-sm text-gray-600 space-y-1">
            <li className="flex items-start">
              <span className="text-green-500 mr-2">•</span> Use biometric
              authentication (Face ID, Touch ID)
            </li>
            <li className="flex items-start">
              <span className="text-green-500 mr-2">•</span> More secure than
              traditional passwords
            </li>
            <li className="flex items-start">
              <span className="text-green-500 mr-2">•</span> Protected against
              phishing attacks
            </li>
          </ul>
        </div>
      </div>
    </div>
  );

  const DashboardView = () => (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent mb-2">
          Welcome back! 👋
        </h1>
        <p className="text-gray-600 text-lg">
          Manage your contacts and communications
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-2xl shadow-lg p-6 border border-blue-200/50 hover:shadow-xl transition-all duration-300 group">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-blue-600 rounded-xl shadow-lg group-hover:scale-110 transition-transform">
              <FiUsers className="w-6 h-6 text-white" />
            </div>
            <span className="text-3xl font-bold text-blue-700">
              {contacts.length}
            </span>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Contacts</h3>
          <p className="text-gray-600 mb-4">Manage your contact list</p>
          <button
            onClick={() => goToView("contacts")}
            className="w-full bg-blue-600 text-white font-medium py-2 px-4 rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
          >
            View Contacts
          </button>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-emerald-100 rounded-2xl shadow-lg p-6 border border-green-200/50 hover:shadow-xl transition-all duration-300 group">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-green-600 rounded-xl shadow-lg group-hover:scale-110 transition-transform">
              <FiPhone className="w-6 h-6 text-white" />
            </div>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Web Dialer
          </h3>
          <p className="text-gray-600 mb-4">Make calls from your browser</p>
          <button
            onClick={() => goToView("dialer")}
            className="w-full bg-green-600 text-white font-medium py-2 px-4 rounded-xl hover:bg-green-700 transition-colors shadow-sm"
          >
            Open Dialer
          </button>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-violet-100 rounded-2xl shadow-lg p-6 border border-purple-200/50 hover:shadow-xl transition-all duration-300 group">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-purple-600 rounded-xl shadow-lg group-hover:scale-110 transition-transform">
              <FiClock className="w-6 h-6 text-white" />
            </div>
            <span className="text-3xl font-bold text-purple-700">
              {callHistory.filter((c) => c.status === "completed").length}
            </span>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Recent Calls
          </h3>
          <p className="text-gray-600 mb-4">View your call history</p>
          <button
            onClick={() => goToView("callHistory")}
            className="w-full bg-purple-600 text-white font-medium py-2 px-4 rounded-xl hover:bg-purple-700 transition-colors shadow-sm"
          >
            View History
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
        <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
          <FiClock className="w-5 h-5 mr-2 text-gray-600" />
          Recent Activity
        </h2>
        <div className="space-y-3">
          {callHistory.slice(0, 3).map((call, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-3 bg-gray-50 rounded-xl"
            >
              <div className="flex items-center space-x-3">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    call.status === "completed" ? "bg-green-100" : "bg-red-100"
                  }`}
                >
                  <FiPhone
                    className={`w-4 h-4 ${
                      call.status === "completed"
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  />
                </div>
                <div>
                  <p className="font-medium text-gray-900">{call.number}</p>
                  <p className="text-sm text-gray-500">
                    {new Date(call.time).toLocaleString()}
                  </p>
                </div>
              </div>
              <span
                className={`px-2 py-1 rounded-full text-xs font-medium ${
                  call.status === "completed"
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {call.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const CallHistoryView = () => (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Call History</h1>
          <p className="text-gray-600 mt-1">Review your recent calls</p>
        </div>
        <button
          className="px-4 py-2 text-violet-600 hover:text-violet-800 font-medium rounded-lg hover:bg-violet-50 transition-colors duration-200"
          onClick={() => goToView("dashboard")}
        >
          ← Back to Dashboard
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
        {callHistory.length === 0 ? (
          <div className="p-12 text-center">
            <FiPhone className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No calls yet
            </h3>
            <p className="text-gray-500">Your call history will appear here</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {callHistory.map((call, idx) => (
              <div key={idx} className="p-6 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div
                      className={`w-12 h-12 rounded-full flex items-center justify-center ${
                        call.status === "completed"
                          ? "bg-green-100"
                          : "bg-red-100"
                      }`}
                    >
                      <FiPhone
                        className={`w-6 h-6 ${
                          call.status === "completed"
                            ? "text-green-600"
                            : "text-red-600"
                        }`}
                      />
                    </div>
                    <div>
                      <p className="text-gray-600 font-mono">{call.number}</p>
                      <p className="text-sm text-gray-500">
                        {new Date(call.time).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${
                        call.status === "completed"
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {call.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const ContactModal = ({ open, onClose, onSave, contact }) => {
    const isEdit = !!contact;
    const TAG_CHOICES = [
      { value: "client", label: "Client" },
      { value: "important", label: "Important" },
      { value: "colleague", label: "Colleague" },
      { value: "vendor", label: "Vendor" },
      { value: "urgent", label: "Urgent" },
    ];
    const allTags = Array.from(
      new Set([
        ...TAG_CHOICES.map((t) => t.value),
        ...contacts.flatMap((c) => c.tags),
      ])
    );
    const [form, setForm] = useState(
      contact || {
        name: "",
        phone: "",
        email: "",
        tags: [],
        lastContacted: new Date().toISOString().slice(0, 10),
        notes: "",
      }
    );
    const [tagInput, setTagInput] = useState("");

    useEffect(() => {
      if (contact) setForm(contact);
      else
        setForm({
          name: "",
          phone: "",
          email: "",
          tags: [],
          lastContacted: new Date().toISOString().slice(0, 10),
          notes: "",
        });
    }, [contact]);

    const handleChange = (e) => {
      const { name, value } = e.target;
      setForm((f) => ({ ...f, [name]: value }));
    };

    const handleTagSelect = (e) => {
      const selectedValues = Array.from(
        e.target.selectedOptions,
        (option) => option.value
      );
      setForm((prev) => ({
        ...prev,
        tags: selectedValues,
      }));
    };

    const handleTagRemove = (tag) => {
      setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }));
    };
    const handleSubmit = (e) => {
      e.preventDefault();
      onSave(form);
    };
    if (!open) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30 animate-fadeIn">
        <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 relative">
          <button
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-700"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
          <h2 className="text-xl font-bold mb-4">
            {isEdit ? "Edit Contact" : "Add Contact"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              className="w-full border rounded px-3 py-2"
              name="name"
              placeholder="Name"
              value={form.name}
              onChange={handleChange}
              required
            />
            <input
              className="w-full border rounded px-3 py-2"
              name="phone"
              placeholder="Phone"
              value={form.phone}
              onChange={handleChange}
              required
            />
            <input
              className="w-full border rounded px-3 py-2"
              name="email"
              placeholder="Email"
              value={form.email}
              onChange={handleChange}
              required
              type="email"
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tags
              </label>
              <select
                multiple
                className="w-full border rounded px-3 py-2 mb-2"
                value={form.tags}
                onChange={handleTagSelect}
              >
                {TAG_CHOICES.map((tag) => (
                  <option key={tag.value} value={tag.value}>
                    {tag.label}
                  </option>
                ))}
                {allTags
                  .filter(
                    (tag) => !TAG_CHOICES.some((choice) => choice.value === tag)
                  )
                  .map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
              </select>
              <div className="flex flex-wrap gap-1">
                {form.tags.map((tag) => (
                  <span
                    key={tag}
                    className="bg-gray-200 text-gray-700 px-2 py-1 rounded-full text-xs flex items-center gap-1"
                  >
                    {tag}
                    <button
                      type="button"
                      className="ml-1 text-red-500 hover:text-red-700"
                      onClick={() => handleTagRemove(tag)}
                      aria-label={`Remove tag ${tag}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <input
              className="w-full border rounded px-3 py-2"
              name="lastContacted"
              type="date"
              value={form.lastContacted}
              onChange={handleChange}
            />
            <textarea
              className="w-full border rounded px-3 py-2"
              name="notes"
              placeholder="Notes"
              value={form.notes}
              onChange={handleChange}
              rows={2}
            />
            <button
              type="submit"
              className="w-full bg-indigo-600 text-white font-semibold py-2 rounded hover:bg-indigo-700"
            >
              {isEdit ? "Save Changes" : "Add Contact"}
            </button>
          </form>
        </div>
      </div>
    );
  };

  const ContactsView = () => {
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedTag, setSelectedTag] = useState("all");
    const [page, setPage] = useState(1);
    const pageSize = 5;

    const allTags = [
      "all",
      ...new Set(contacts.flatMap((contact) => contact.tags)),
    ];

    const filteredContacts = contacts.filter((contact) => {
      const matchesSearch =
        contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contact.phone.includes(searchTerm) ||
        contact.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contact.notes.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesTag =
        selectedTag === "all" || contact.tags.includes(selectedTag);

      return matchesSearch && matchesTag;
    });

    const totalPages = Math.ceil(filteredContacts.length / pageSize);
    const paginatedContacts = filteredContacts.slice(
      (page - 1) * pageSize,
      page * pageSize
    );

    const handleAdd = () => {
      setEditingContact(null);
      setShowContactModal(true);
    };
    const handleEdit = (contact) => {
      setEditingContact(contact);
      setShowContactModal(true);
    };

    const handleSave = async (form) => {
      try {
        const formData = new FormData();
        formData.append("name", form.name);
        formData.append("phone", form.phone);
        formData.append("email", form.email);
        formData.append("last_contacted", form.lastContacted);
        formData.append("notes", form.notes);
        formData.append("tags", JSON.stringify(form.tags));

        let response, data;
        if (editingContact && editingContact.id) {
          response = await fetch(
            `${API_BASE_URL}/contacts/${editingContact.id}/update/`,
            {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${localStorage.getItem("access")}`,
              },
              body: formData,
            }
          );
          data = await response.json();
          if (response.ok) {
            setContacts((prev) =>
              prev.map((c) => (c.id === editingContact.id ? data : c))
            );
            toast.success("Contact updated successfully");
          } else {
            toast.error(data.detail || "Failed to update contact.");
          }
        } else {
          response = await fetch(`${API_BASE_URL}/add-contact/`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${localStorage.getItem("access")}`,
            },
            body: formData,
          });
          data = await response.json();
          if (response.ok) {
            setContacts((prev) => [...prev, data]);
            toast.success("Contact added successfully");
          } else {
            toast.error(data.detail || "Failed to add contact.");
          }
        }
        setShowContactModal(false);
        setEditingContact(null);
      } catch (err) {
        toast.error("Something went wrong.");
      }
    };

    const handleClose = () => {
      setShowContactModal(false);
      setEditingContact(null);
    };
    const handlePageChange = (newPage) => {
      setPage(newPage);
    };

    const openDialerWithNumber = (number) => {
      setDialNumber(number);
      goToView("dialer");
    };

    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Contacts</h1>
          <p className="text-gray-600 mt-2">
            Manage your contact information ({contacts.length} total)
          </p>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <FiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search contacts..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPage(1);
                  }}
                  className={`w-full pl-10 pr-4 py-2 border rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow ${
                    searchTerm ? "ring-2 ring-indigo-200" : ""
                  }`}
                  aria-label="Search contacts"
                />
              </div>
              <div className="flex items-center space-x-2">
                <select
                  value={selectedTag}
                  onChange={(e) => {
                    setSelectedTag(e.target.value);
                    setPage(1);
                  }}
                  className={`flex items-center space-x-2 px-4 py-2 border rounded-md hover:bg-gray-50 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow ${
                    selectedTag !== "all" ? "ring-2 ring-indigo-200" : ""
                  }`}
                  aria-label="Filter by tag"
                >
                  {allTags.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag === "all"
                        ? "All Tags"
                        : tag.charAt(0).toUpperCase() + tag.slice(1)}
                    </option>
                  ))}
                </select>
                <button
                  className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 transition-colors"
                  onClick={handleAdd}
                  aria-label="Add contact"
                >
                  Add Contact
                </button>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            {paginatedContacts.length > 0 ? (
              <table className="w-full">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Contact
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Phone
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Tags
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Last Contact
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {paginatedContacts.map((contact) => (
                    <tr key={contact.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center"
                            style={{
                              backgroundColor: `hsl(${
                                (contact.name.charCodeAt(0) * 13) % 360
                              }, 70%, 85%)`,
                            }}
                          >
                            <span className="text-indigo-600 font-semibold text-sm">
                              {contact.name
                                .split(" ")
                                .map((n) => n[0])
                                .join("")}
                            </span>
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">
                              {contact.name}
                            </div>
                            <div className="text-sm text-gray-500">
                              {contact.email}
                            </div>
                            {contact.notes && (
                              <div className="text-xs text-gray-400 mt-1 max-w-xs truncate">
                                {contact.notes}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 font-mono">
                          {contact.phone}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-wrap gap-1">
                          {contact.tags.map((tag) => (
                            <span
                              key={tag}
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                tag === "important"
                                  ? "bg-red-100 text-red-800"
                                  : tag === "urgent"
                                  ? "bg-orange-100 text-orange-800"
                                  : tag === "client"
                                  ? "bg-blue-100 text-blue-800"
                                  : tag === "colleague"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-gray-100 text-gray-800"
                              }`}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(contact.lastContacted).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center space-x-2">
                          <button
                            className="text-gray-600 hover:text-gray-900 p-1 hover:bg-gray-50 rounded"
                            title="Edit"
                            aria-label={`Edit ${contact.name}`}
                            onClick={() => handleEdit(contact)}
                          >
                            <FiSettings className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-6 text-center">
                <FiUsers className="mx-auto w-12 h-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">
                  No contacts found
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  {searchTerm || selectedTag !== "all"
                    ? "Try adjusting your search or filter criteria."
                    : "Get started by adding your first contact."}
                </p>
              </div>
            )}
          </div>
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 px-6 py-3 bg-gray-50 border-t border-gray-200">
              <button
                className="px-3 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1}
                aria-label="Previous page"
              >
                Previous
              </button>
              <span className="text-sm text-gray-700">
                Page {page} of {totalPages}
              </span>
              <button
                className="px-3 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                onClick={() => handlePageChange(page + 1)}
                disabled={page === totalPages}
                aria-label="Next page"
              >
                Next
              </button>
            </div>
          )}
        </div>
        <ContactModal
          open={showContactModal}
          onClose={handleClose}
          onSave={handleSave}
          contact={editingContact}
        />
      </div>
    );
  };


  const DialerView = () => <TwilioDialer />;

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div
        className={`fixed inset-0 z-40 bg-black bg-opacity-30 transition-opacity md:hidden ${
          sidebarOpen ? "block" : "hidden"
        }`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden={!sidebarOpen}
      />
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-white shadow-lg border-r border-gray-200 transform transition-transform duration-300 md:hidden ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Sidebar"
      >
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-100">
          <div className="flex items-center space-x-2">
            <FiPhone className="w-6 h-6 text-indigo-600" />
            <span className="text-lg font-semibold text-indigo-700">
              DialMate
            </span>
          </div>
          <button
            className="text-gray-400 hover:text-gray-700 text-2xl"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            ×
          </button>
        </div>
        <div className="flex flex-col gap-2 p-4">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setCurrentView(item.id);
                setSidebarOpen(false);
              }}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-all duration-200 ${
                currentView === item.id
                  ? "bg-violet-100 text-violet-700 shadow-sm"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium text-red-600 hover:bg-red-50 transition-colors mt-4"
          >
            <FiLogOut className="w-5 h-5" />
            <span>Logout</span>
          </button>
        </div>
      </aside>
      <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-6">
              <button
                className="md:hidden p-2 rounded-lg text-gray-600 hover:text-indigo-700 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </button>
              <div className="flex items-center space-x-2">
                <FiPhone className="w-6 h-6 text-indigo-600" />
                <span className="text-lg font-semibold text-indigo-700">
                  DialMate
                </span>
              </div>
              <div className="hidden md:flex items-center space-x-2">
                <span className="text-xl font-bold bg-gradient-to-r from-violet-600 to-blue-600 bg-clip-text text-transparent">
                  Dashboard
                </span>
              </div>
              <div className="hidden md:flex space-x-1">
                {navItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setCurrentView(item.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center space-x-2 ${
                      currentView === item.id
                        ? "bg-violet-100 text-violet-700 shadow-sm"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                    }`}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="hidden md:flex items-center space-x-3">
              <button
                onClick={handleLogout}
                className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <FiLogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </nav>
      {currentView === "dashboard" && <DashboardView />}
      {currentView === "contacts" && <ContactsView />}
      {currentView === "dialer" && <DialerView />}
      {currentView === "callHistory" && <CallHistoryView />}
    </div>
  );
};
export default App;
