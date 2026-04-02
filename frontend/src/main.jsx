import { StrictMode, Fragment } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// StrictMode double-invokes useEffect in development, which causes the socket
// service to register duplicate listeners (connect / disconnect / state_update).
// The socket singleton is idempotent for connect/disconnect calls, but listener
// registration is not — socket.io-client does not deduplicate .on() calls.
//
// We disable StrictMode by default and allow opt-in via VITE_STRICT_MODE=true.
// In production builds StrictMode has no effect anyway.
const Wrapper = import.meta.env.VITE_STRICT_MODE === "true" ? StrictMode : Fragment;

createRoot(document.getElementById("root")).render(
  <Wrapper>
    <App />
  </Wrapper>
);
