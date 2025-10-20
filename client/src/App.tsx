import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Onboarding from "./pages/Onboarding";
import Movies from "./pages/Movies";
import TVShows from "./pages/TVShows";
import Search from "./pages/Search";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import Player from "./pages/Player";
import { AuthProvider } from "./contexts/auth";
import Settings from "./pages/Settings";
import TraktCallback from "./pages/TraktCallback";
import SetupGuard from "./components/SetupGuard";
import TVEpisodes from "./pages/TVEpisodes";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route element={<SetupGuard />}>
              <Route path="/" element={<Home />} />
              <Route path="/movies" element={<Movies />} />
              <Route path="/tv-shows" element={<TVShows />} />
              <Route path="/search" element={<Search />} />
              <Route path="/watch/:type/:imdbId" element={<Player />} />
              <Route path="/tv/:imdbId/episodes" element={<TVEpisodes />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="/auth/trakt/callback" element={<TraktCallback />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
