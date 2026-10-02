import React from 'react';
import { Outlet } from 'react-router-dom';
import TopNav from './TopNav';
import './MerchantLayout.css';

export default function MerchantLayout() {
  return (
    <div className="merchant-layout">
      <TopNav />
      <main className="merchant-content">
        <div className="merchant-content-inner">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
