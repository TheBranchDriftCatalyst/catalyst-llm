import { useState, useEffect, useCallback } from 'react';
import { fetchModelsWithRouting, type ModelWithRouting } from '../lib/litellm';

export interface GroupedModels {
  mac: ModelWithRouting[];
  cluster: ModelWithRouting[];
  cloud: ModelWithRouting[];
}

export function useModels() {
  const [models, setModels] = useState<ModelWithRouting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchModelsWithRouting();
      setModels(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const grouped: GroupedModels = {
    mac: models.filter(m => m.endpoint?.type === 'mac'),
    cluster: models.filter(m => m.endpoint?.type === 'cluster'),
    cloud: models.filter(m => m.endpoint?.type === 'cloud'),
  };

  return {
    models,
    grouped,
    loading,
    error,
    refresh: loadModels,
  };
}
