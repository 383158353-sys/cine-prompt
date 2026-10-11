import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

export default function ProtectedRoute({ unauthenticatedElement }) {
  const { isLoadingAuth, authError } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError && authError.type === 'auth_required') {
    return unauthenticatedElement || <Navigate to="/login" replace />;
  }

  if (authError && authError.type === 'user_not_registered') {
    return unauthenticatedElement || <Navigate to="/login" replace />;
  }

  return <Outlet />;
}