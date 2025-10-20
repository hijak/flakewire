import { ChevronRight } from "lucide-react";
import MediaCard from "./MediaCard";

interface Media {
  id: string | number;
  title: string;
  year: string;
  rating?: number;
  image: string;
  genre?: string;
}

interface MediaRowProps {
  title: string;
  items: Media[];
  onPlay?: (id: string | number) => void;
  onInfo?: (id: string | number) => void;
  playLabel?: string;
}

const MediaRow = ({ title, items, onPlay, onInfo, playLabel }: MediaRowProps) => {
  return (
    <section className="mb-12 animate-fade-in">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-6 px-4 md:px-0">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground">
          {title}
        </h2>
      </div>

      {/* Media Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 px-4 md:px-0">
        {items.map((item) => (
          <MediaCard key={item.id} {...item} playLabel={playLabel} onPlay={() => onPlay?.(item.id)} onInfo={() => onInfo?.(item.id)} />
        ))}
      </div>
    </section>
  );
};

export default MediaRow;
