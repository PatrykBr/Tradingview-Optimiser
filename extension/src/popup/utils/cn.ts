type ClassValue = string | number | null | undefined | false;

export function cn(...classes: ClassValue[]) {
  return classes.filter(Boolean).join(" ");
}

