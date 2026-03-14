'use client';

import { useNavigation } from '@/lib/navigation';
import HomeView from '@/views/HomeView';
import LoginView from '@/views/LoginView';
import RegisterView from '@/views/RegisterView';
import ProfileView from '@/views/ProfileView';
import SearchView from '@/views/SearchView';
import WatchView from '@/views/WatchView';
import DownloadsView from '@/views/DownloadsView';

export default function Page() {
  const { route } = useNavigation();

  switch (route.name) {
    case 'login':
      return <LoginView />;
    case 'register':
      return <RegisterView />;
    case 'profile':
      return <ProfileView />;
    case 'search':
      return <SearchView />;
    case 'watch':
      return <WatchView />;
    case 'downloads':
      return <DownloadsView />;
    case 'home':
    default:
      return <HomeView />;
  }
}
