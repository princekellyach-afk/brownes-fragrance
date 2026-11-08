
import { useState, useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  useMapEvents,
  useMap
} from "react-leaflet";
import L from "leaflet";

// Fix Leaflet marker icons
delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png"
});

const defaultPosition = [5.6037, -0.1870];

function LocationMarker({ position, setPosition }) {
  useMapEvents({
    click(event) {
      setPosition([
        event.latlng.lat,
        event.latlng.lng
      ]);
    }
  });

  return position ? (
    <Marker
      position={position}
      draggable={true}
      eventHandlers={{
        dragend(event) {
          const location = event.target.getLatLng();

          setPosition([
            location.lat,
            location.lng
          ]);
        }
      }}
    />
  ) : null;
}

function MoveMap({ position }) {
  const map = useMap();

  useEffect(() => {
    if (position) {
      map.setView(position, 16);
    }
  }, [position, map]);

  return null;
}

export default function DeliveryMap({ onLocationSelect }) {
  const [position, setPosition] = useState(null);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  function updatePosition(location) {
    setPosition(location);

    const latitude = location[0];
    const longitude = location[1];

    onLocationSelect({
      latitude,
      longitude,
      mapLink: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
    });
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      alert("Your browser does not support GPS location.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (location) => {
        updatePosition([
          location.coords.latitude,
          location.coords.longitude
        ]);
      },
      () => {
        alert(
          "Location access failed. Please allow location permission or search for your location."
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 15000
      }
    );
  }

  async function searchLocation(event) {
    event.preventDefault();

    if (!search.trim()) return;

    setSearching(true);
    setSearchError("");

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(search)}`
      );

      if (!response.ok) {
        throw new Error("Search failed");
      }

      const results = await response.json();

      if (!results.length) {
        setSearchError("Location not found. Try another search.");
        return;
      }

      updatePosition([
        Number(results[0].lat),
        Number(results[0].lon)
      ]);
    } catch (error) {
      setSearchError(
        "Unable to search right now. Please try again."
      );
    } finally {
      setSearching(false);
    }
  }

  return (
    <div style={{ marginTop: "20px" }}>
      <form
        onSubmit={searchLocation}
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "12px",
          flexWrap: "wrap"
        }}
      >
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search area, street or landmark..."
          style={{
            flex: "1",
            minWidth: "180px",
            padding: "13px",
            border: "1px solid #d4b16a",
            borderRadius: "5px"
          }}
        />

        <button
          type="submit"
          disabled={searching}
          style={{
            background: "#171512",
            color: "#d4b16a",
            padding: "13px 18px",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer"
          }}
        >
          {searching ? "SEARCHING..." : "SEARCH"}
        </button>
      </form>

      {searchError && (
        <p style={{ color: "red", fontSize: "13px" }}>
          {searchError}
        </p>
      )}

      <button
        type="button"
        onClick={useCurrentLocation}
        style={{
          background: "#171512",
          color: "#d4b16a",
          padding: "13px 18px",
          border: "none",
          borderRadius: "5px",
          cursor: "pointer",
          marginBottom: "12px"
        }}
      >
        USE MY CURRENT LOCATION
      </button>

      <p style={{ color: "#171512", fontSize: "14px" }}>
        Search for your area or tap anywhere on the map
        to place your delivery pin. You can drag the pin
        to adjust its position.
      </p>

      <MapContainer
        center={defaultPosition}
        zoom={12}
        style={{
          height: "350px",
          width: "100%",
          borderRadius: "8px",
          zIndex: 1
        }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <LocationMarker
          position={position}
          setPosition={updatePosition}
        />

        <MoveMap position={position} />
      </MapContainer>

      {position && (
        <div
          style={{
            marginTop: "12px",
            padding: "12px",
            background: "#f5f0e6",
            borderRadius: "5px",
            color: "#171512"
          }}
        >
          <strong>Delivery location selected!</strong>

          <p style={{ fontSize: "13px" }}>
            Latitude: {position[0].toFixed(6)}
            <br />
            Longitude: {position[1].toFixed(6)}
          </p>
        </div>
      )}

      <p style={{ fontSize: "11px", color: "#777" }}>
        Map data © OpenStreetMap contributors.
        Search provided by OpenStreetMap Nominatim.
      </p>
    </div>
  );
}
