interface HeroImageProps {
  imageSrc?: string
  alt?: string
}

export function HeroImage({
  imageSrc = '/login.png',
  alt = 'Login background'
}: HeroImageProps) {
  return (
    <div className="hidden w-3/5 bg-muted/50 p-1 lg:block">
      <img
        src={imageSrc}
        alt={alt}
        className="h-full w-full rounded-lg object-cover"
      />
    </div>
  )
}
