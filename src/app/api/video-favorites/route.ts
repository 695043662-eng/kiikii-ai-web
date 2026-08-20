import { createFavoritesRoutes } from '@/lib/favorites-factory';

export const { GET, POST, PUT, DELETE } = createFavoritesRoutes('video_favorites');
