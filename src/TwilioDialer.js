import React, { useState, useEffect, useRef } from "react";
import { FiPhone, FiUsers } from "react-icons/fi";
import { Device } from "@twilio/voice-sdk";

const TwilioDialer = ({
  goToView = () => {},
  callHistory = [],
  contacts = [],
  setCallHistory = () => {},
  setDialNumber: externalSetDialNumber,
  dialNumber: externalDialNumber,
  user = {},
  // API_BASE_URL = "http://127.0.0.1:8000",
  API_BASE_URL = "https://dialmate-backend.onrender.com"
}) => {
  const [internalDialNumber, setInternalDialNumber] = useState("");
  const [callState, setCallState] = useState("idle");
  const [callStatusMsg, setCallStatusMsg] = useState("");
  const [device, setDevice] = useState(null);
  const [connection, setConnection] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const callStartTime = useRef(null);
  const callLoggedRef = useRef(false);
  const refreshTimeoutRef = useRef(null);

  const dialNumber = externalDialNumber !== undefined ? externalDialNumber : internalDialNumber;
  const setDialNumber = externalSetDialNumber || setInternalDialNumber;

  const formatToE164 = (num) => {
    const cleaned = num.replace(/[^\d+]/g, "");
    if (/^\+\d{10,15}$/.test(cleaned)) return cleaned; 
    if (/^[789]\d{9}$/.test(cleaned)) return `+91${cleaned}`;
    if (/^[2-9]\d{9}$/.test(cleaned)) return `+1${cleaned}`;
    return null;
  };

  const isValidDialNumber = (num) => !!formatToE164(num);

  const [callDuration, setCallDuration] = useState(0);
  const callDurationInterval = useRef(null);

  const getAccessToken = React.useCallback(async () => {
    try {
      const token = localStorage.getItem("access");
      if (!token) {
        throw new Error("No authentication token found");
      }

      const response = await fetch(`${API_BASE_URL}/api/twilio-token/`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get access token: ${response.statusText}`);
      }

      const data = await response.json();
      return data.token;
    } catch (error) {
      console.error("Error getting access token:", error);
      throw error;
    }
  }, [API_BASE_URL]);

  useEffect(() => {
    let mounted = true;
    let twilioDevice = null;

    const setupDevice = async () => {
      setLoading(true);
      setError("");
      try {
        const accessToken = await getAccessToken();
        if (!mounted) return;

        twilioDevice = new Device(accessToken, {
          logLevel: 1,
          codecPreferences: ["opus", "pcmu"],
        });

        twilioDevice.on("registered", () => {
          console.log("Twilio Device registered");
          setCallStatusMsg("Ready to dial");
          setLoading(false);
        });

        twilioDevice.on("error", (error) => {
          console.error("Twilio Device error:", error);
          setError(`Device Error: ${error.message}`);
          setCallStatusMsg("Device Error");
          setLoading(false);
        });

        twilioDevice.on("incoming", (conn) => {
          console.log("Incoming call:", conn);
           setCallState("dialing");
           setCallStatusMsg("Dialing...");
        });

        twilioDevice.on("tokenWillExpire", async () => {
          console.log("Token will expire, refreshing...");
          try {
            const newToken = await getAccessToken();
            twilioDevice.updateToken(newToken);
          } catch (error) {
            console.error("Failed to refresh token:", error);
            setError("Failed to refresh token");
          }
        });

        await twilioDevice.register();
        if (mounted) {
          setDevice(twilioDevice);
        }
      } catch (error) {
        console.error("Failed to setup Twilio Device:", error);
        if (mounted) {
          setError(`Failed to setup Twilio Device: ${error.message}`);
          setCallStatusMsg("Device setup failed");
          setLoading(false);
        }
      }
    };

    setupDevice();

    return () => {
      mounted = false;
      if (twilioDevice) {
        twilioDevice.destroy();
      }
      // Clear any pending refresh timeouts
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, [API_BASE_URL, getAccessToken]);

  const requestMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      stream.getTracks().forEach(track => track.stop());
      
      console.log("Microphone access granted");
      return true;
    } catch (err) {
      console.error("Microphone access denied:", err);
      setCallStatusMsg("Microphone access denied");
      setCallState("error");
      setError("Microphone access is required to make calls");
      return false;
    }
  };

  const handleKeypad = (val) => {
    console.log('Keypad pressed:', val, 'Current state:', callState, 'Loading:', loading);
    
    if (["idle", "ended", "error"].includes(callState) && !loading) {
      const safeDialNumber = dialNumber || "";
      console.log('Current dial number:', safeDialNumber);
      
      if (safeDialNumber.length < 15) {
        const newNumber = safeDialNumber + val;
        console.log('Setting new number:', newNumber);
        setDialNumber(newNumber);
      }
    }
  };

  const handleBackspace = () => {
    if (["idle", "ended", "error"].includes(callState) && !loading) {
      const safeDialNumber = dialNumber || "";
      const newNumber = safeDialNumber.slice(0, -1);
      setDialNumber(newNumber);
    }
  };

  const handleCall = async () => {
    if (!dialNumber || !device) {
      setError("Please enter a number and ensure device is ready");
      return;
    }
    const formatted = formatToE164(dialNumber);
    if (!formatted) {
      setError("Please enter a valid Indian or US number (10 digits) or E.164 format (+91..., +1...)");
      return;
    }

    const micPermission = await requestMicrophone();
    if (!micPermission) return;

    setCallState("ringing");
    setCallStatusMsg("Ringing...");
    setError("");
    callStartTime.current = new Date();
    callLoggedRef.current = false;
    setCallDuration(0);
    if (callDurationInterval.current) clearInterval(callDurationInterval.current);
    callDurationInterval.current = setInterval(() => {
      setCallDuration(Math.floor((new Date() - callStartTime.current) / 1000));
    }, 1000);

    try {
      const conn = await device.connect({ 
        params: { 
          To: formatted 
        } 
      });

      setConnection(conn);
      let callAnswered = false;

      conn.on("accept", () => {
        console.log("Call accepted");
        setCallState("in-call");
        setCallStatusMsg("In Call");
        callAnswered = true;
        logCall("in_call");
      });

      conn.on("disconnect", (conn) => {
        console.log("Call disconnected");
        handleCallEnd(callAnswered);
      });

      conn.on("error", (error) => {
        console.error("Call error:", error);
        let msg = error && error.message ? error.message : "Call Error";
        if (msg.includes("31005")) msg = "Twilio: Call could not be completed. Check your TwiML App Voice URL and number format.";
        if (msg.includes("31404")) msg = "Twilio: Number not found or not allowed. Use E.164 format and verify number in Twilio.";
        setError(`Call Error: ${msg}`);
        setCallState("error");
        setCallStatusMsg("Call Failed");
        setConnection(null);
        logCall("failed");
        if (callDurationInterval.current) clearInterval(callDurationInterval.current);
        scheduleCallCleanup();
      });

      conn.on("ringing", () => {
        console.log("Call ringing");
        setCallState("ringing");
        setCallStatusMsg("Ringing...");
        logCall("ringing");
      });

      conn.on("cancel", () => {
        console.log("Call cancelled");
        handleCallEnd(false, "cancelled");
      });

    } catch (error) {
      console.error("Failed to make call:", error);
      let msg = error && error.message ? error.message : "Call failed";
      if (msg.includes("31005")) msg = "Twilio: Call could not be completed. Check your TwiML App Voice URL and number format.";
      if (msg.includes("31404")) msg = "Twilio: Number not found or not allowed. Use E.164 format and verify number in Twilio.";
      setError(`Call failed: ${msg}`);
      setCallState("error");
      setCallStatusMsg("Call Failed");
      logCall("failed");
      if (callDurationInterval.current) clearInterval(callDurationInterval.current);
      scheduleCallCleanup();
    }
  };

  // New unified call end handler
  const handleCallEnd = (wasAnswered, customStatus = null) => {
    console.log("Handling call end - wasAnswered:", wasAnswered, "customStatus:", customStatus);
    
    setCallState("ended");
    setCallStatusMsg("Call Ended");
    setConnection(null);
    
    if (callDurationInterval.current) {
      clearInterval(callDurationInterval.current);
      callDurationInterval.current = null;
    }
    
    let status = customStatus;
    if (!status) {
      status = wasAnswered ? "ended" : "no-answer";
    }
    
    logCall(status);
    scheduleCallCleanup();
  };

  const handleHangup = () => {
    if (connection) {
      connection.disconnect();
    } else {
      // If no active connection, just reset the state
      handleCallEnd(false, "ended");
    }
  };

  const callIdRef = useRef(null);

  // Improved call cleanup with proper timing
  const scheduleCallCleanup = () => {
    console.log("Scheduling call cleanup");
    
    // Clear any existing timeout
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    
    // Schedule cleanup after a short delay to ensure all state updates are complete
    refreshTimeoutRef.current = setTimeout(() => {
      console.log("Executing call cleanup");
      
      // Clear the dial number
      setDialNumber("");
      
      // Reset error state
      setError("");
      
      // Refresh call history
      refreshCallHistory();
      
      // Reset call state to idle after a brief delay
      setTimeout(() => {
        setCallState("idle");
        setCallStatusMsg("Ready to dial");
      }, 500);
      
    }, 1000); // Wait 1 second before cleanup
  };

  const refreshCallHistory = async () => {
    console.log("Refreshing call history");
    try {
      const token = localStorage.getItem("access");
      if (!token) {
        console.warn("No token available for refreshing call history");
        return;
      }
      
      const response = await fetch(`${API_BASE_URL}/api/call-history/`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log("Call history refreshed successfully, entries:", data.length);
        setCallHistory(data);
      } else {
        console.error("Failed to refresh call history:", response.status, response.statusText);
      }
    } catch (err) {
      console.error("Error refreshing call history:", err);
    }
  };

  const logCall = async (status) => {
    console.log("Logging call with status:", status);
    
    if (callLoggedRef.current && ["ended", "failed", "cancelled"].includes(status)) {
      console.log("Call already logged, skipping duplicate log");
      return;
    }

    const duration = callStartTime.current
      ? Math.floor((new Date() - callStartTime.current) / 1000)
      : 0;

    const callRecord = {
      number: dialNumber,
      time: new Date().toISOString(),
      status,
      duration,
    };

    // Update local state immediately
    setCallHistory((prev) => [callRecord, ...prev]);

    if (!dialNumber || dialNumber.trim() === "") {
      console.warn("Not logging call to backend: dialNumber is empty");
      return;
    }

    try {
      const token = localStorage.getItem("access");
      if (!token) {
        console.warn("Not logging call to backend: No authentication token");
        return;
      }

      if (!callIdRef.current && status === "ringing") {
        console.log("Creating new call record");
        const response = await fetch(`${API_BASE_URL}/api/make-call/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            phone_number: dialNumber,
            status,
            duration,
          }),
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        callIdRef.current = result.call_id;
        console.log("Call created, call_id:", callIdRef.current);
        
      } else if (callIdRef.current && ["in_call", "ended", "failed", "cancelled", "no-answer"].includes(status)) {
        console.log("Updating call status to:", status);
        const response = await fetch(`${API_BASE_URL}/api/update-call-status/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            call_id: callIdRef.current,
            status,
            duration,
          }),
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log("Call status updated:", result);
        
        // Mark as logged and reset call ID for final statuses
        if (["ended", "failed", "cancelled", "no-answer"].includes(status)) {
          callLoggedRef.current = true;
          callIdRef.current = null;
          console.log("Call logging completed for final status:", status);
        }
      }
    } catch (error) {
      console.error('Failed to log/update call to backend:', error);
    }
  };

  const isCallActive = ["in-call", "ringing", "dialing"].includes(callState);
  const canInput = ["idle", "ended", "error"].includes(callState) && !loading;
  const canCall = !loading && !isCallActive && dialNumber && isValidDialNumber(dialNumber);

  return (
    <div className="w-full flex flex-col items-center py-4 px-2">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-4 sm:p-6 border border-gray-100">
        <div className="text-center mb-4">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow mb-2">
            <FiPhone className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-1">Web Dialer</h1>
          <p className="text-gray-600 text-sm">Enter a number to make a call</p>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 mb-4 border border-gray-200">
          <div className="text-center">
            <div className="text-2xl font-mono font-semibold text-gray-900 mb-1 min-h-[2rem] flex items-center justify-center tracking-wider">
              {dialNumber || (
                <span className="text-gray-400 text-base">Enter number</span>
              )}
            </div>
            {callState === "in-call" && (
              <div className="mt-1 text-xs text-green-700">
                Duration: {Math.floor(callDuration / 60)}:{(callDuration % 60).toString().padStart(2, '0')}
              </div>
            )}
            
            {callStatusMsg && (
              <div className="mt-2">
                <div
                  className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
                    callState === "error"
                      ? "bg-red-100 text-red-700 border border-red-200"
                      : callState === "in-call"
                      ? "bg-green-100 text-green-700 border border-green-200"
                      : callState === "ringing" || callState === "dialing"
                      ? "bg-blue-100 text-blue-700 border border-blue-200"
                      : "bg-gray-100 text-gray-700 border border-gray-200"
                  }`}
                >
                  {(callState === "ringing" || callState === "dialing") && (
                    <div className="animate-pulse w-2 h-2 bg-current rounded-full mr-2"></div>
                  )}
                  {callStatusMsg}
                </div>
              </div>
            )}
            
            {error && (
              <div className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">
                {error}
              </div>
            )}
            
            {loading && (
              <div className="mt-2 text-xs text-blue-600">
                Setting up device...
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { num: "1", letters: "" },
            { num: "2", letters: "ABC" },
            { num: "3", letters: "DEF" },
            { num: "4", letters: "GHI" },
            { num: "5", letters: "JKL" },
            { num: "6", letters: "MNO" },
            { num: "7", letters: "PQRS" },
            { num: "8", letters: "TUV" },
            { num: "9", letters: "WXYZ" },
            { num: "*", letters: "" },
            { num: "0", letters: "+" },
            { num: "#", letters: "" },
          ].map(({ num, letters }) => (
            <button
              key={num}
              className={`aspect-square bg-white border border-gray-200 rounded-lg text-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 group ${
                canInput 
                  ? "hover:border-blue-300 hover:shadow cursor-pointer" 
                  : "opacity-50 cursor-not-allowed"
              }`}
              onClick={() => handleKeypad(num)}
              disabled={!canInput}
              tabIndex={canInput ? 0 : -1}
            >
              <div className="flex flex-col items-center justify-center h-full">
                <span className={`text-lg font-bold transition-colors ${
                  canInput 
                    ? "text-gray-900 group-hover:text-blue-600" 
                    : "text-gray-400"
                }`}>
                  {num}
                </span>
                {letters && (
                  <span className="text-[10px] font-medium text-gray-500 mt-0.5 tracking-wider">
                    {letters}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-center space-x-4">
          <button
            className={`w-12 h-12 rounded-full flex items-center justify-center shadow transition-all duration-200 focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              isCallActive
                ? "bg-red-500 hover:bg-red-600 focus:ring-red-200 text-white"
                : canCall
                ? "bg-green-500 hover:bg-green-600 focus:ring-green-200 text-white"
                : "bg-gray-300 text-gray-400"
            }`}
            onClick={isCallActive ? handleHangup : handleCall}
            disabled={isCallActive ? false : !canCall}
            title={isCallActive ? "Hang Up" : "Call"}
          >
            {isCallActive ? (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z" />
              </svg>
            ) : (
              <FiPhone className="w-6 h-6" />
            )}
          </button>
          <button
            className="w-12 h-12 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 hover:text-gray-800 shadow transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleBackspace}
            disabled={!canInput}
            title="Delete"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default TwilioDialer;