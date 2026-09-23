import { LocaleProvider } from "@/components/LocaleProvider";
import NewsApp from "@/components/NewsApp";

export default function HomePage() {
  return (
    <LocaleProvider>
      <NewsApp />
    </LocaleProvider>
  );
}
