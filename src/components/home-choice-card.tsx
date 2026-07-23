import Link from "next/link";

interface HomeChoiceCardProps {
  href: string;
  title: string;
  description: string;
  icon: string;
}

export function HomeChoiceCard({
  href,
  title,
  description,
  icon,
}: HomeChoiceCardProps) {
  return (
    <Link className="choice-card" href={href} aria-label={title}>
      <span className="choice-icon" aria-hidden="true">
        {icon}
      </span>
      <span>
        <h2>{title}</h2>
        <p>{description}</p>
      </span>
      <span className="choice-arrow" aria-hidden="true">
        →
      </span>
    </Link>
  );
}
