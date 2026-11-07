import { createFileRoute } from "@tanstack/react-router";
import MessagesPage from "@/merchant/features/tools/MessagesPage";
import { merchantHead } from "@/merchant/head";

export const Route = createFileRoute("/merchant/_shell/messages")({
  head: () => merchantHead("Customer messages", "Questions, requests and support from customers."),
  component: MessagesPage,
});
