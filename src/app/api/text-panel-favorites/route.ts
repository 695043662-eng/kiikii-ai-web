import { createFavoritesRoutes } from '@/lib/favorites-factory';

export const { GET, POST, PUT, DELETE } = createFavoritesRoutes('text_panel_favorites');
