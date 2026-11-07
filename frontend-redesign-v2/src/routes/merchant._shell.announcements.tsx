import { createFileRoute } from "@tanstack/react-router";
import AnnouncementsPage from "@/merchant/features/tools/AnnouncementsPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/announcements")({
  head: () => merchantHead("Announcements", "Tell your followers what’s new."),
  component: AnnouncementsPage,
});
