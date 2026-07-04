import React, { useState } from 'react';
import { useApp } from './context/AppContext';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Login from './components/Login';
import { Toast } from './components/UI';

// Pages
import Dashboard from './pages/Dashboard';
import Findings from './pages/Findings';
import CAPA from './pages/CAPA';
import Planning from './pages/Planning';
import Execution from './pages/Execution';
import Reports from './pages/Reports';
import Learnings from './pages/Learnings';
import Media from './pages/Media';
import MasterData from './pages/MasterData';
import AdminPanel from './pages/AdminPanel';
import MyTasks from './pages/MyTasks';
import ManagerPanel from './pages/ManagerPanel';
import MasterTracker from './pages/MasterTracker';
import OcpManual from './pages/OcpManual';
import ImportData from './pages/ImportData';
import Profile from './pages/Profile';

export default function App() {
  const { currentUser, currentPage, canAccess } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Date filters passed from Topbar to active views
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [appliedDate, setAppliedDate] = useState({ from: '', to: '' });

  if (!currentUser) {
    return (
      <>
        <Login />
        <Toast />
      </>
    );
  }

  const renderActivePage = () => {
    if (!canAccess(currentPage) && currentPage !== 'profile') {
      return (
        <div className="flex flex-col items-center justify-center h-[50vh] text-center">
          <div className="text-lg font-bold" style={{ color: 'var(--red)' }}>Access Denied</div>
          <div className="text-xs mt-1" style={{ color: 'var(--text3)' }}>You do not have permission to view this compliance module.</div>
        </div>
      );
    }

    switch (currentPage) {
      case 'dashboard':     return <Dashboard />;
      case 'findings':      return <Findings dateFrom={appliedDate.from} dateTo={appliedDate.to} />;
      case 'capa':          return <CAPA />;
      case 'planning':      return <Planning />;
      case 'execution':     return <Execution />;
      case 'reports':       return <Reports />;
      case 'learnings':     return <Learnings />;
      case 'media':         return <Media />;
      case 'mastertracker': return <MasterTracker />;
      case 'masterdata':    return <MasterData />;
      case 'adminpanel':    return <AdminPanel />;
      case 'mytasks':       return <MyTasks />;
      case 'managerpanel':  return <ManagerPanel />;
      case 'ocp':           return <OcpManual />;
      case 'importdata':    return <ImportData />;
      case 'profile':       return <Profile />;
      default:              return <Dashboard />;
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main viewport */}
      <div className="main-viewport">
        {/* Topbar */}
        <Topbar
          onMenuClick={() => setSidebarOpen(true)}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFrom={setDateFrom}
          onDateTo={setDateTo}
          onApplyDate={() => setAppliedDate({ from: dateFrom, to: dateTo })}
          onClearDate={() => { setDateFrom(''); setDateTo(''); setAppliedDate({ from: '', to: '' }); }}
        />

        {/* Content Wrapper */}
        <main className="content-wrapper" id="content-container">
          {renderActivePage()}
        </main>
      </div>

      <Toast />
    </div>
  );
}
