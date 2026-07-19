import { notFound } from "next/navigation";
import Shell from "@/components/Shell";
import Studio from "./Studio";
import { requireUser } from "@/lib/session";
import { loadProject } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(`/projects/${id}`);
  const project = await loadProject(id, user.id);
  if (!project) notFound();

  const center =
    project.center_lat != null && project.center_lng != null
      ? { lat: project.center_lat, lng: project.center_lng }
      : null;

  return (
    <Shell crumb={project.address ?? undefined}>
      <div className="mb-5">
        <h1 className="font-display text-3xl tracking-tight text-ink">
          {project.name}
        </h1>
        {project.address ? (
          <p className="mt-1 text-sm text-muted">{project.address}</p>
        ) : null}
      </div>

      <Studio
        projectId={project.id}
        center={center}
        initialFeatures={project.features}
        initialValidations={project.validations}
      />
    </Shell>
  );
}
