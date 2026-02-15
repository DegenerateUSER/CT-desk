// ─────────────────────────────────────────────────────────────────────────────
// Navigation Context — State-based routing for Electron (no URL routing)
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

// ── Route Definitions ────────────────────────────────────────────────────────

export type RouteName = 'home' | 'login' | 'register' | 'profile' | 'search' | 'watch' | 'downloads';

export interface RouteState {
  name: RouteName;
  params: Record<string, string>;
}

interface NavigationContextType {
  /** Current route */
  route: RouteState;

  /** Navigate to a route */
  navigate: (name: RouteName, params?: Record<string, string>) => void;

  /** Go back (returns to home if no history) */
  goBack: () => void;

  /** Navigation history length */
  historyLength: number;
}

const NavigationContext = createContext<NavigationContextType | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<RouteState>({ name: 'home', params: {} });
  const [history, setHistory] = useState<RouteState[]>([]);

  const navigate = useCallback((name: RouteName, params: Record<string, string> = {}) => {
    setHistory((prev) => [...prev, route]);
    setRoute({ name, params });
    // Scroll to top on navigation
    window.scrollTo(0, 0);
  }, [route]);

  const goBack = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) {
        setRoute({ name: 'home', params: {} });
        return [];
      }
      const newHistory = [...prev];
      const previous = newHistory.pop()!;
      setRoute(previous);
      return newHistory;
    });
    window.scrollTo(0, 0);
  }, []);

  return (
    <NavigationContext.Provider value={{ route, navigate, goBack, historyLength: history.length }}>
      {children}
    </NavigationContext.Provider>
  );
}

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation must be used within NavigationProvider');
  return ctx;
}

/**
 * Convenience hook to get a route parameter.
 */
export function useRouteParam(key: string): string | undefined {
  const { route } = useNavigation();
  return route.params[key];
}

// ── NavLink Component ────────────────────────────────────────────────────────

interface NavLinkProps {
  to: RouteName;
  params?: Record<string, string>;
  children: ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  [key: string]: any;
}

/**
 * Drop-in replacement for next/link's <Link>.
 * Uses the state-based navigation system instead of URL routing.
 */
export function NavLink({ to, params, children, className, onClick, ...rest }: NavLinkProps) {
  const { navigate } = useNavigation();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onClick) onClick(e);
    navigate(to, params);
  };

  return (
    <a href="#" onClick={handleClick} className={className} {...rest}>
      {children}
    </a>
  );
}
