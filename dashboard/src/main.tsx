import React from "react";
import { createRoot } from "react-dom/client";
import "@titan-design/react-ui/theme/global.css";
import "./styles.css";
import { App } from "./App";
import { loadData } from "./data";

createRoot(document.getElementById("root")!).render(<App data={loadData()} />);
