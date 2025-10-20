import { Play, Info, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface MediaCardProps {
  title: string;
  year?: string | number | null;
  rating?: number;
  image: string;
  genre?: string;
  onPlay?: () => void;
  onInfo?: () => void;
  playLabel?: string;
}

const MediaCard = ({ title, year, rating, image, genre, onPlay, onInfo, playLabel = 'Play' }: MediaCardProps) => {
  const [imgOk, setImgOk] = useState(!!image);
  const handlePlay = (e?: React.MouseEvent) => { e?.stopPropagation?.(); onPlay && onPlay(); };
  const handleInfo = (e?: React.MouseEvent) => { e?.stopPropagation?.(); onInfo && onInfo(); };

  return (
    <Card className="group relative overflow-hidden bg-card border-border/50 card-hover cursor-pointer" onClick={handlePlay}>
      {/* Image */}
      <div className="aspect-[2/3] overflow-hidden bg-muted relative">
        {imgOk ? (
          <img
            src={image}
            alt={title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
            onError={() => setImgOk(false)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <img src={'/logo.png'} alt="placeholder" className="h-12 w-12 opacity-80" style={{ backgroundColor: 'transparent' }} />
          </div>
        )}
        
        {/* Overlay on hover */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
          <div className="transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
            <h3 className="font-semibold text-lg mb-2 text-foreground">{title}</h3>
            
            <div className="flex items-center gap-2 mb-3 text-sm">
              {year && (<span className="text-muted-foreground">{year}</span>)}
              <span className="text-muted-foreground">•</span>
              <div className="flex items-center gap-1 text-success">
                <Star className="h-3 w-3 fill-current" />
                <span className="font-semibold">{rating ?? '—'}</span>
              </div>
            </div>
            
            {genre && (
              <Badge variant="secondary" className="mb-3 text-xs">
                {genre}
              </Badge>
            )}
            
            <div className="flex gap-2">
              <Button variant="hero" size="sm" className="flex-1 gap-1" onClick={handlePlay}>
                <Play className="h-3 w-3 fill-current" />
                {playLabel}
              </Button>
              <Button variant="glass" size="sm" onClick={handleInfo}>
                <Info className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Quick info visible without hover */}
      {typeof rating === 'number' && (
        <div className="absolute top-2 right-2">
          <Badge variant="outline" className="glass border-primary/50 text-primary text-xs font-bold">
            ★ {rating}
          </Badge>
        </div>
      )}
    </Card>
  );
};

export default MediaCard;
