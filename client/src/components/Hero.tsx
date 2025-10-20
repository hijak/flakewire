import { Play, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";

type HeroProps = {
  background?: string;
  title: string;
  year?: string | number | null;
  rating?: string | number | null;
  genre?: string;
  plot?: string;
  imdbId?: string;
  type?: 'movie'|'tv';
  overlay?: React.ReactNode;
}

const Hero = ({ background, title, year, rating, genre, plot, imdbId, type = 'movie', overlay }: HeroProps) => {
  const navigate = useNavigate();
  return (
    <section className="relative h-[80vh] min-h-[600px] w-full overflow-hidden">
      {/* Background Image */}
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: background ? `url(${background})` : undefined }}
      >
        <div className="absolute inset-0 gradient-hero" />
      </div>

      {/* Content */}
      <div className="relative container mx-auto px-4 h-full flex items-end pb-24">
        {overlay && (
          <div className="absolute top-4 right-4 z-20">
            {overlay}
          </div>
        )}
        <div className="max-w-2xl animate-fade-in-up">
          {/* Title */}
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold mb-4 text-foreground hero-title">{title}</h1>
          
          {/* Metadata */}
          <div className="flex items-center gap-3 mb-6">
            {year && (
              <Badge variant="outline" className="glass border-primary/50 text-primary font-semibold">{year}</Badge>
            )}
            <div className="flex items-center gap-2 text-sm">
              {rating && <span className="text-success font-bold">★ {rating}</span>}
              <span className="text-muted-foreground">IMDb</span>
            </div>
            {genre && (<Badge variant="secondary" className="font-medium">{genre}</Badge>)}
          </div>

          {/* Description */}
          {plot && (
            <p className="text-lg text-foreground/95 mb-8 max-w-xl leading-relaxed hero-description">{plot}</p>
          )}

          {/* CTAs */}
          <div className="flex flex-wrap gap-4">
            <Button
              variant="hero"
              size="lg"
              className="gap-2"
              onClick={()=> {
                if (!imdbId) return;
                if (type === 'tv') navigate(`/tv/${imdbId}/episodes`);
                else navigate(`/watch/movie/${imdbId}`);
              }}
            >
              <Play className="h-5 w-5 fill-current" />
              {type === 'tv' ? 'Episodes' : 'Play Now'}
            </Button>
            <Button variant="glass" size="lg" className="gap-2" onClick={()=> imdbId && window.open(`https://www.imdb.com/title/${imdbId}`, '_blank')}>
              <Info className="h-5 w-5" />
              More Info
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
