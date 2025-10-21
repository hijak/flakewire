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
import NotFound from "./pages/NotFound";
import Player from "./pages/Player";
import Settings from "./pages/Settings";
// Single-user mode: no auth context or callback page
import SetupGuard from "./components/SetupGuard";
import TVEpisodes from "./pages/TVEpisodes";
import Calendar from "./pages/Calendar";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
          <Routes>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route element={<SetupGuard />}>
              <Route path="/" element={<Home />} />
              <Route path="/movies" element={<Movies />} />
              <Route path="/tv-shows" element={<TVShows />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/search" element={<Search />} />
              <Route path="/watch/:type/:imdbId" element={<Player />} />
              <Route path="/tv/:imdbId/episodes" element={<TVEpisodes />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            {/* No auth routes in single-user mode */}
            <Route path="*" element={<NotFound />} />
          </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
