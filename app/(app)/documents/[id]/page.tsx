import { DocumentDetailClient } from "@/components/DocumentDetailClient";

type DocumentDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function DocumentDetailPage({ params }: DocumentDetailPageProps) {
  const { id } = await params;

  return <DocumentDetailClient documentId={id} />;
}
