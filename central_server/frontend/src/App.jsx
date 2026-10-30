import React, { useState, useEffect } from 'react';

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [relays, setRelays] = useState([]);

  useEffect(() => {
    fetch('/api/v1/system/overview')
      .then(res => res.json())
      .then(data => setOverview(data))
      .catch(console.error);

    fetch('/api/v1/relays')
      .then(res => res.json())
      .then(data => setRelays(data))
      .catch(console.error);
  }, []);

  return (
    <div className="app-container">
      <header className="topbar">
        <h1>SmartHome Central Management Platform</h1>
        <div className="status">v1.6.0 | Windows Host</div>
      </header>
      <div className="main-content">
        <h2>System Overview</h2>
        {overview && (
          <div className="metrics">
            <div>Nodes: {overview.nodes?.total} ({overview.nodes?.online} online)</div>
            <div>Relays: {overview.relays?.total} ({overview.relays?.on} ON)</div>
          </div>
        )}
      </div>
    </div>
  );
}
