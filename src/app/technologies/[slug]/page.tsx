import { permanentRedirect } from "next/navigation";

// The manufacturing choices have been permanently retired.
export default function RetiredTechnologyPage() {
  permanentRedirect("/catalog/");
}
