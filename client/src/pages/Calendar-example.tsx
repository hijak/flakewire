import { useState } from "react";
import { Calendar as CalendarIcon, Tv, Clock, Star } from "lucide-react";
import Header from "@/components/Header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Episode {
  id: number;
  show: string;
  episode: string;
  season: number;
  episodeNumber: number;
  time: string;
  rating: number;
  network: string;
  image?: string;
}

const CalendarPage = () => {
  const [date, setDate] = useState<Date | undefined>(new Date());

  // Mock data - in production, this would come from Trakt API
  const todayEpisodes: Episode[] = [
    {
      id: 1,
      show: "Digital Dreams",
      episode: "The Protocol Begins",
      season: 3,
      episodeNumber: 5,
      time: "20:00",
      rating: 8.7,
      network: "Netflix",
    },
    {
      id: 2,
      show: "Dark Protocol",
      episode: "Shadow Games",
      season: 2,
      episodeNumber: 8,
      time: "21:00",
      rating: 8.5,
      network: "HBO",
    },
    {
      id: 3,
      show: "Echo Chamber",
      episode: "Reverberations",
      season: 1,
      episodeNumber: 12,
      time: "22:00",
      rating: 8.3,
      network: "Amazon Prime",
    },
  ];

  const upcomingEpisodes: Episode[] = [
    {
      id: 4,
      show: "Void Walker",
      episode: "Into the Darkness",
      season: 4,
      episodeNumber: 3,
      time: "Tomorrow, 20:00",
      rating: 8.9,
      network: "Netflix",
    },
    {
      id: 5,
      show: "Stellar Drift",
      episode: "Cosmic Winds",
      season: 2,
      episodeNumber: 15,
      time: "Tomorrow, 21:30",
      rating: 8.1,
      network: "Hulu",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 animate-fade-in-up">
          <div className="flex items-center gap-3 mb-2">
            <CalendarIcon className="h-8 w-8 text-primary" />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              TV Schedule
            </h1>
          </div>
          <p className="text-muted-foreground">
            Track your favorite shows and never miss an episode
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Calendar Widget */}
          <div className="lg:col-span-1">
            <Card className="glass border-border/50 shadow-[var(--shadow-elegant)] animate-fade-in-up">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarIcon className="h-5 w-5 text-primary" />
                  Select Date
                </CardTitle>
              </CardHeader>
              <CardContent className="flex justify-center">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  className="rounded-md"
                />
              </CardContent>
            </Card>

            {/* Quick Stats */}
            <Card className="glass border-border/50 shadow-[var(--shadow-elegant)] mt-6 animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
              <CardHeader>
                <CardTitle className="text-lg">This Week</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Episodes</span>
                  <span className="text-2xl font-bold text-primary">12</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Shows</span>
                  <span className="text-2xl font-bold">8</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Watch Time</span>
                  <span className="text-lg font-semibold">6h 40m</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Episodes List */}
          <div className="lg:col-span-2 space-y-6">
            {/* Today's Episodes */}
            <div className="animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <Tv className="h-6 w-6 text-primary" />
                Today's Episodes
              </h2>
              <div className="space-y-3">
                {todayEpisodes.map((episode) => (
                  <Card
                    key={episode.id}
                    className="glass border-border/50 shadow-[var(--shadow-elegant)] hover-scale transition-all duration-300 group"
                  >
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="text-lg font-bold group-hover:text-primary transition-colors">
                              {episode.show}
                            </h3>
                            <Badge variant="secondary" className="text-xs">
                              {episode.network}
                            </Badge>
                          </div>
                          <p className="text-muted-foreground mb-2">
                            {episode.episode}
                          </p>
                          <div className="flex items-center gap-4 text-sm">
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <Clock className="h-4 w-4" />
                              {episode.time}
                            </span>
                            <span className="text-muted-foreground">
                              S{episode.season}E{episode.episodeNumber}
                            </span>
                            <span className="flex items-center gap-1">
                              <Star className="h-4 w-4 text-primary fill-primary" />
                              {episode.rating}
                            </span>
                          </div>
                        </div>
                        <Button variant="hero" size="sm">
                          Watch
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {/* Upcoming Episodes */}
            <div className="animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
              <h2 className="text-2xl font-bold mb-4">Upcoming</h2>
              <div className="space-y-3">
                {upcomingEpisodes.map((episode) => (
                  <Card
                    key={episode.id}
                    className="glass border-border/50 shadow-[var(--shadow-elegant)] hover-scale transition-all duration-300 group"
                  >
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="text-lg font-bold group-hover:text-primary transition-colors">
                              {episode.show}
                            </h3>
                            <Badge variant="outline" className="text-xs">
                              {episode.network}
                            </Badge>
                          </div>
                          <p className="text-muted-foreground mb-2">
                            {episode.episode}
                          </p>
                          <div className="flex items-center gap-4 text-sm">
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <Clock className="h-4 w-4" />
                              {episode.time}
                            </span>
                            <span className="text-muted-foreground">
                              S{episode.season}E{episode.episodeNumber}
                            </span>
                            <span className="flex items-center gap-1">
                              <Star className="h-4 w-4 text-primary fill-primary" />
                              {episode.rating}
                            </span>
                          </div>
                        </div>
                        <Button variant="outline" size="sm">
                          Set Reminder
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CalendarPage;
