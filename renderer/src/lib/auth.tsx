'use client';

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { userAuthApi, UserProfile } from './api';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: UserProfile | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function UserAuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);

  const refreshProfile = useCallback(async () => {
    try {
      const profile = await userAuthApi.getProfile();
      setUser(profile);
      setIsAuthenticated(true);
    } catch {
      localStorage.removeItem('user_token');
      setIsAuthenticated(false);
      setUser(null);
    }
  }, []);

  // Check for existing token on mount
  useEffect(() => {
    const token = localStorage.getItem('user_token');
    if (token) {
      refreshProfile().finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [refreshProfile]);

  const login = async (username: string, password: string) => {
    const res = await userAuthApi.login(username, password);
    localStorage.setItem('user_token', res.token);
    setUser(res.user);
    setIsAuthenticated(true);
  };

  const logout = () => {
    localStorage.removeItem('user_token');
    setIsAuthenticated(false);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, user, login, logout, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useUserAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useUserAuth must be used within UserAuthProvider');
  return ctx;
}
