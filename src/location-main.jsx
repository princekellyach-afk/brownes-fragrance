
import React from "react";
import ReactDOM from "react-dom/client";
import LocationPicker from "./LocationPicker.jsx";
import "leaflet/dist/leaflet.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LocationPicker />
  </React.StrictMode>
);
