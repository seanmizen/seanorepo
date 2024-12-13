import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// import CssBaseline from "@mui/material/CssBaseline";
// import { darkTheme } from "./theme";
// import { ThemeProvider } from "@mui/material";

const rootEl = document.getElementById("root");
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(
    <React.StrictMode>
      {/* <ThemeProvider theme={darkTheme}>
        <CssBaseline /> */}
      <App />
      {/* </ThemeProvider> */}
    </React.StrictMode>
  );
}
