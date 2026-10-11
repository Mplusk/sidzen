import { redirect } from "next/navigation";

// Old bookmarks lead to store contacts; the self-service portal is retired.
export default function PersonalDataPage() {
  redirect("/contacts/");
}
