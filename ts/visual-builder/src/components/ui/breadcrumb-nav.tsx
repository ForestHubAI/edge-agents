import { useLocation, Link } from 'react-router-dom';
import { Home, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from './breadcrumb';
import { useProjects } from '@/hooks/useProjects';
import { useRagCollections } from '@/hooks/useRagCollections';
import { useNetworks } from '@/hooks/useNetworks';
import { useAgents } from '@/hooks/useAgents';

/**
 * BreadcrumbNav Component
 * 
 * Displays contextual navigation breadcrumbs based on the current route.
 * Automatically resolves project names from IDs.
 * 
 * Features:
 * - Shows real project names (not IDs)
 * - Responsive (hidden on mobile)
 * - Keyboard accessible
 * - Truncates long labels
 * - Schema.org breadcrumb list (via shadcn Breadcrumb)
 */
export function BreadcrumbNav() {
  const location = useLocation();
  const { t } = useTranslation();
  const { projects } = useProjects();
  const { collections } = useRagCollections();
  const { networks } = useNetworks();
  const { allAgents } = useAgents();
  
  const pathSegments = location.pathname.split('/').filter(Boolean);
  
  // Don't show breadcrumbs on home page
  if (pathSegments.length === 0) {
    return null;
  }
  
  const routeNames: Record<string, string> = {
    'projects': t('navbar.projects'),
    'hardware': t('navbar.hardware'),
    'teams': t('navbar.teams'),
    'analytics': t('navbar.analytics'),
    'performance': t('navbar.monitoring'),
    'compliance': t('navbar.compliance'),
    'knowledge-bases': t('navbar.knowledgeBases'),
    'settings': t('navbar.settings'),
    'credits': t('navbar.credits'),
    'edit': t('common.edit'),
    'chat': t('knowledgeBases.chat.title'),
    'templates': t('navbar.templates'),
    'devices': t('navbar.devices'),
    'networks': t('navbar.networks', 'Networks'),
    'monitoring': t('navbar.monitoring'),
    'agents': t('navbar.agents', 'Agents'),
  };

  // Resolve query-based sub-filters for breadcrumb
  const filterNames: Record<string, string> = {
    'favorites': t('navbar.favorites', 'Favorites'),
    'folders': t('navbar.folders', 'Folders'),
  };
  const searchFilter = new URLSearchParams(location.search).get('filter');

  // Get real project name if we're in a project route
  const getSegmentLabel = (segment: string, index: number): string => {
    // Check if this is a project ID (UUID pattern)
    if (pathSegments[index - 1] === 'projects' && segment.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      const project = projects?.find(p => p.id === segment);
      return project?.name || t('common.loading');
    }
    if (pathSegments[index - 1] === 'knowledge-bases' && segment.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      const collection = collections?.find(c => c.id === segment);
      return collection?.name || t('common.loading');
    }
    if (pathSegments[index - 1] === 'networks') {
      const network = networks?.find(n => n.id === segment);
      return network?.name || t('common.loading');
    }
    if (pathSegments[index - 1] === 'agents') {
      const agent = allAgents?.find(a => a.id === segment);
      return agent?.name || t('common.loading');
    }
    return routeNames[segment] || segment;
  };

  return (
    <nav aria-label="Breadcrumb" className="hidden md:block px-8 py-3.5 border-b bg-sidebar">
      <Breadcrumb>
        <BreadcrumbList className="flex-wrap">
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link 
                to="/" 
                className="flex items-center gap-1 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded px-1"
                aria-label="Home"
              >
                <span className="flex items-center gap-1">
                  <Home className="h-4 w-4" />
                  <span className="sr-only">Dashboard</span>
                </span>
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          
          {pathSegments.map((segment, index) => {
            const path = `/${pathSegments.slice(0, index + 1).join('/')}`;
            const isLast = index === pathSegments.length - 1 && !searchFilter;
            const label = getSegmentLabel(segment, index);

            return (
              <span key={path} className="flex items-center">
                <BreadcrumbSeparator>
                  <ChevronRight className="h-4 w-4" />
                </BreadcrumbSeparator>
                <BreadcrumbItem>
                  {isLast ? (
                    <BreadcrumbPage className="max-w-[200px] truncate">
                      {label}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link
                        to={path}
                        className="hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded px-1 max-w-[150px] truncate inline-block"
                      >
                        {label}
                      </Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </span>
            );
          })}
          {searchFilter && filterNames[searchFilter] && (
            <span className="flex items-center">
              <BreadcrumbSeparator>
                <ChevronRight className="h-4 w-4" />
              </BreadcrumbSeparator>
              <BreadcrumbItem>
                <BreadcrumbPage className="max-w-[200px] truncate">
                  {filterNames[searchFilter]}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </span>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </nav>
  );
}
