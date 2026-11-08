
import { useState } from "react";
import DeliveryMap from "./DeliveryMap";

export default function LocationPicker() {
  const [selectedLocation, setSelectedLocation] = useState(null);

  function confirmLocation() {
    if (!selectedLocation) {
      alert("Please select your delivery location first.");
      return;
    }

    if (!window.opener || window.opener.closed) {
      alert("Please open this page from Brownes Fragrance checkout.");
      return;
    }

    window.opener.postMessage(
      {
        type: "BROWNES_DELIVERY_LOCATION",
        location: selectedLocation,
      },
      window.location.origin
    );

    window.close();
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f7f3eb",
      padding: "25px",
      color: "#201d18",
      fontFamily: "Arial, sans-serif",
    }}>
      <div style={{
        maxWidth: "850px",
        margin: "auto",
      }}>
        <h1 style={{
          fontFamily: "Georgia, serif",
          letterSpacing: "2px",
        }}>
          BROWNES FRAGRANCE
        </h1>

        <h2>Choose Your Delivery Location</h2>

        <p>
          Use your current GPS location or tap the map to place
          your delivery pin. You can drag the pin to adjust it.
        </p>

        <DeliveryMap onLocationSelect={setSelectedLocation} />

        {selectedLocation && (
          <div style={{
            background: "#eee7d9",
            padding: "15px",
            marginTop: "15px",
            lineHeight: "1.8",
          }}>
            <strong>Selected location</strong>
            <br />
            Latitude: {selectedLocation.latitude.toFixed(6)}
            <br />
            Longitude: {selectedLocation.longitude.toFixed(6)}
          </div>
        )}

        <button
          onClick={confirmLocation}
          disabled={!selectedLocation}
          style={{
            width: "100%",
            padding: "16px",
            marginTop: "20px",
            background: selectedLocation ? "#c5a45d" : "#aaa",
            color: "#171612",
            border: "none",
            cursor: selectedLocation ? "pointer" : "not-allowed",
            fontWeight: "bold",
            letterSpacing: "1px",
          }}
        >
          CONFIRM LOCATION AND RETURN TO CHECKOUT
        </button>
      </div>
    </div>
  );
}
