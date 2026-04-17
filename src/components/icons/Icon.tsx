import { ImgHTMLAttributes } from 'react';

interface IconProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  name: string;
}

export function Icon({ name, className = '', alt = '', ...props }: IconProps) {
  return (
    <img
      src={`/icons/${name}.svg`}
      alt={alt || name}
      className={`dark:invert ${className}`}
      {...props}
    />
  );
}
