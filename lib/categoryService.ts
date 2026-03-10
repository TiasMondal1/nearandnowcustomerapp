import { supabase } from './supabase';

export interface Category {
  id: string;
  name: string;
  slug: string;
  image_url?: string;
  icon?: string;
  color?: string;
  display_order?: number;
  is_active?: boolean;
  created_at?: string;
}

export async function getAllCategories(): Promise<Category[]> {
  try {
    // First try with is_active filter, fallback without it if column doesn't exist
    let query = supabase.from('categories').select('*');
    
    const { data, error } = await query.order('display_order', { ascending: true });

    if (error) {
      console.error('Error fetching categories:', error);
      return [];
    }

    // Filter by is_active in code if the column exists
    const categories = (data || []) as Category[];
    return categories.filter(cat => cat.is_active !== false);
  } catch (err) {
    console.error('Failed to fetch categories:', err);
    return [];
  }
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('slug', slug)
      .single();

    if (error) {
      console.error('Error fetching category:', error);
      return null;
    }

    // Check is_active in code if the field exists
    const category = data as Category;
    if (category && category.is_active === false) {
      return null;
    }

    return category;
  } catch (err) {
    console.error('Failed to fetch category:', err);
    return null;
  }
}
