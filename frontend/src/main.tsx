import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./styles/skin-fonts.css";
import "./styles/skins.css";
import "./styles/skin-native.css";
import "./styles/skin-interactions.css";
import "./styles/shells.css";
import { registerServiceWorker } from "./lib/sw-register";

createRoot(document.getElementById("root")!).render(<App />);

// Production-only — see sw-register.ts.
registerServiceWorker();
