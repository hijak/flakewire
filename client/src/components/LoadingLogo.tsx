
const LoadingLogo = ({ text = 'Loading…' }: { text?: string }) => {
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4">
        <img
          src={'/logo.png'}
          alt="Loading"
          className="h-16 w-16 animate-spin-slow"
          style={{ backgroundColor: 'transparent', filter: 'drop-shadow(0 0 12px rgba(229,9,20,0.6))' }}
        />
        <div className="text-sm text-muted-foreground">{text}</div>
      </div>
      <style>
        {`
          @keyframes spin-slow { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
          .animate-spin-slow { animation: spin-slow 1.6s linear infinite; }
        `}
      </style>
    </div>
  )
}

export default LoadingLogo
