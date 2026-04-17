export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          role: 'founder' | 'client' | 'employee'
          full_name: string
          avatar_url: string | null
          theme: 'light' | 'dark' | 'system'
          onboarding_completed: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          role?: 'founder' | 'client' | 'employee'
          full_name: string
          avatar_url?: string | null
          theme?: 'light' | 'dark' | 'system'
          onboarding_completed?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          role?: 'founder' | 'client' | 'employee'
          full_name?: string
          avatar_url?: string | null
          theme?: 'light' | 'dark' | 'system'
          onboarding_completed?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      workspaces: {
        Row: {
          id: string
          name: string
          slug: string
          logo_url: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          logo_url?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          logo_url?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
      }
      workspace_members: {
        Row: {
          id: string
          workspace_id: string
          user_id: string
          role: 'owner' | 'employee' | 'client'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          user_id: string
          role?: 'owner' | 'employee' | 'client'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          user_id?: string
          role?: 'owner' | 'employee' | 'client'
          created_at?: string
          updated_at?: string
        }
      }
      deals: {
        Row: {
          id: string
          workspace_id: string
          prospect_name: string
          services: string
          deal_value: number
          stage: 'lead' | 'proposal_sent' | 'negotiation' | 'closed_won' | 'closed_lost'
          next_action: string | null
          position: number
          closed_date: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          prospect_name: string
          services: string
          deal_value?: number
          stage?: 'lead' | 'proposal_sent' | 'negotiation' | 'closed_won' | 'closed_lost'
          next_action?: string | null
          position?: number
          closed_date?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          prospect_name?: string
          services?: string
          deal_value?: number
          stage?: 'lead' | 'proposal_sent' | 'negotiation' | 'closed_won' | 'closed_lost'
          next_action?: string | null
          position?: number
          closed_date?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
      }
      channels: {
        Row: {
          id: string
          workspace_id: string
          stream_channel_id: string
          name: string
          description: string | null
          is_default: boolean
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          stream_channel_id: string
          name: string
          description?: string | null
          is_default?: boolean
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          stream_channel_id?: string
          name?: string
          description?: string | null
          is_default?: boolean
          created_by?: string
          created_at?: string
          updated_at?: string
        }
      }
      channel_members: {
        Row: {
          id: string
          channel_id: string
          user_id: string
          joined_at: string
        }
        Insert: {
          id?: string
          channel_id: string
          user_id: string
          joined_at?: string
        }
        Update: {
          id?: string
          channel_id?: string
          user_id?: string
          joined_at?: string
        }
      }
      direct_messages: {
        Row: {
          id: string
          workspace_id: string
          stream_channel_id: string
          user1_id: string
          user2_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          stream_channel_id: string
          user1_id: string
          user2_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          stream_channel_id?: string
          user1_id?: string
          user2_id?: string
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_or_create_dm_channel: {
        Args: {
          p_workspace_id: string
          p_user1_id: string
          p_user2_id: string
        }
        Returns: {
          id: string
          stream_channel_id: string
          user1_id: string
          user2_id: string
        }[]
      }
    }
    Enums: {
      user_role: 'founder' | 'client' | 'employee'
      workspace_role: 'owner' | 'employee' | 'client'
      deal_stage: 'lead' | 'proposal_sent' | 'negotiation' | 'closed_won' | 'closed_lost'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
