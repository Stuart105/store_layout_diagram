'use client';

import { SalesDataProvider } from '@/contexts/SalesDataContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SalesDataProvider>
      {children}
    </SalesDataProvider>
  );
}
