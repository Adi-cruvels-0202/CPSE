import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useActiveStore } from '../../hooks/useStore';
import './Sidebar.css';

const navGroups = [
  {
    items: [
      { label: 'Dashboard', path: '/dashboard', icon: '📊' },
    ],
  },
  {
    title: 'Store',
    items: [
      { label: 'Store Setup', path: '/store/setup', icon: '🏪' },
      { label: 'Business Hours', path: '/store/hours', icon: '🕐' },
      { label: 'Delivery', path: '/store/delivery', icon: '🚚' },
      { label: 'Payments', path: '/store/payments', icon: '💳' },
      { label: 'Storefront', path: '/store/storefront', icon: '🌐' },
    ],
  },
  {
    title: 'Catalogue',
    items: [
      { label: 'Products', path: '/products', icon: '📦' },
      { label: 'Categories', path: '/categories', icon: '🏷️' },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { label: 'Stock', path: '/inventory', icon: '📋' },
      { label: 'Purchases', path: '/purchases', icon: '🛒' },
      { label: 'Batches', path: '/batches', icon: '📅' },
      { label: 'History', path: '/inventory/history', icon: '📜' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { label: 'New Sale', path: '/sales/new', icon: '💰' },
      { label: 'Sales History', path: '/sales', icon: '📈' },
    ],
  },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside className={`sidebar glass-nav ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo">
          {!collapsed && <span className="sidebar-logo-text">Merchant One</span>}
          {collapsed && <span className="sidebar-logo-icon">MO</span>}
        </div>
        <button
          className="sidebar-toggle"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '→' : '←'}
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="Main navigation">
        {navGroups.map((group, gi) => (
          <div key={gi} className="sidebar-group">
            {group.title && !collapsed && (
              <span className="sidebar-group-title">{group.title}</span>
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`
                }
                title={item.label}
              >
                <span className="sidebar-link-icon">{item.icon}</span>
                {!collapsed && <span className="sidebar-link-label">{item.label}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button className="sidebar-link" onClick={handleLogout} title="Logout">
          <span className="sidebar-link-icon">🚪</span>
          {!collapsed && <span className="sidebar-link-label">Logout</span>}
        </button>
      </div>
    </aside>
  );
}
