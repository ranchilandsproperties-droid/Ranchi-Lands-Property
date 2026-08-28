import React, { useState } from "react";
import UploadForm from "./components/UploadForm.jsx";
import DesignEditor from "./components/DesignEditor.jsx";

export default function App() {
  // Minimal state-based "routing" — no router needed for a two-screen flow
  const [project, setProject] = useState(null);

  return (
    <div style={{ minHeight: "100vh", background: "#0f1115", color: "#f1f1f1", fontFamily: "sans-serif" }}>
      <header style={{ padding: "18px 28px", borderBottom: "1px solid #23262e" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>🏞️ Land Reels Studio</h1>
        <p style={{ margin: "4px 0 0", color: "#9aa0aa", fontSize: 14 }}>
          Upload a land walkthrough → design a Reels-ready promo frame → export, then the raw upload is cleaned off the server.
        </p>
      </header>

      <main style={{ padding: 24 }}>
        {!project ? (
          <UploadForm onCreated={setProject} />
        ) : (
          <DesignEditor project={project} onBack={() => setProject(null)} />
        )}
      </main>
    </div>
  );
}
