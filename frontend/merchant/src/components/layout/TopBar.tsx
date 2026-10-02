import React from 'react';
import { useAuth } from '../../hooks/useAuth';
import './TopBar.css';

export default function TopBar() {
  const { user } = useAuth();

  return (
    <header className="topbar">
      <div className="topbar-left">
        {/* Breadcrumb or page context goes here */}
      </div>
      <div className="topbar-right">
        <div className="topbar-user">
          <div className="topbar-avatar">
            {user?.name?.charAt(0).toUpperCase() || 'U'}
          </div>
          <span className="topbar-user-name">{user?.name}</span>
        </div>
      </div>
    </header>
  );
}
