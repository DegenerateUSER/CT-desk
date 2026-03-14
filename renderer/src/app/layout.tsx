import type { Metadata } from 'next';
import './globals.css';
import { QueryProvider } from '@/components/QueryProvider';
import { UserAuthProvider } from '@/lib/auth';
import { NavigationProvider } from '@/lib/navigation';

export const metadata: Metadata = {
  title: 'CheapTricks',
  description: 'CheapTricks Desktop — Stream your Drive videos',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <QueryProvider>
          <UserAuthProvider>
            <NavigationProvider>
              {children}
            </NavigationProvider>
          </UserAuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
