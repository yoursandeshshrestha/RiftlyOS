export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      channel_members: {
        Row: {
          channel_id: string
          id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          id?: string
          joined_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          id?: string
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_default: boolean | null
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          billing_address: Json | null
          billing_email: string | null
          client_user_id: string | null
          created_at: string
          default_currency: string
          gocardless_customer_id: string | null
          id: string
          stripe_customer_id: string | null
          vat_number: string | null
          workspace_id: string
        }
        Insert: {
          billing_address?: Json | null
          billing_email?: string | null
          client_user_id?: string | null
          created_at?: string
          default_currency?: string
          gocardless_customer_id?: string | null
          id?: string
          stripe_customer_id?: string | null
          vat_number?: string | null
          workspace_id: string
        }
        Update: {
          billing_address?: Json | null
          billing_email?: string | null
          client_user_id?: string | null
          created_at?: string
          default_currency?: string
          gocardless_customer_id?: string | null
          id?: string
          stripe_customer_id?: string | null
          vat_number?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          closed_date: string | null
          created_at: string
          created_by: string
          deal_value: number
          id: string
          next_action: string | null
          position: number
          prospect_name: string
          services: string
          stage: Database["public"]["Enums"]["deal_stage"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          closed_date?: string | null
          created_at?: string
          created_by: string
          deal_value?: number
          id?: string
          next_action?: string | null
          position?: number
          prospect_name: string
          services: string
          stage?: Database["public"]["Enums"]["deal_stage"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          closed_date?: string | null
          created_at?: string
          created_by?: string
          deal_value?: number
          id?: string
          next_action?: string | null
          position?: number
          prospect_name?: string
          services?: string
          stage?: Database["public"]["Enums"]["deal_stage"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_messages: {
        Row: {
          created_at: string
          id: string
          updated_at: string
          user1_id: string
          user2_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          updated_at?: string
          user1_id: string
          user2_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          updated_at?: string
          user1_id?: string
          user2_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_messages_user1_id_fkey"
            columns: ["user1_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_user2_id_fkey"
            columns: ["user2_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_queue: {
        Row: {
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          last_retry_at: string | null
          payload: Json
          recipient: string
          resend_id: string | null
          retry_count: number
          sent_at: string | null
          status: Database["public"]["Enums"]["email_delivery_status"]
          subject: string | null
          template: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          last_retry_at?: string | null
          payload?: Json
          recipient: string
          resend_id?: string | null
          retry_count?: number
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_delivery_status"]
          subject?: string | null
          template: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          last_retry_at?: string | null
          payload?: Json
          recipient?: string
          resend_id?: string | null
          retry_count?: number
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_delivery_status"]
          subject?: string | null
          template?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_queue_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_queue_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_paid: number
          client_user_id: string | null
          created_at: string
          currency: string
          due_date: string | null
          hosted_url: string | null
          id: string
          issued_at: string | null
          paid_at: string | null
          pdf_url: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_invoice_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subscription_id: string | null
          subtotal: number
          tax_total: number
          total: number
          type: Database["public"]["Enums"]["invoice_type"]
          workspace_id: string
        }
        Insert: {
          amount_paid?: number
          client_user_id?: string | null
          created_at?: string
          currency?: string
          due_date?: string | null
          hosted_url?: string | null
          id?: string
          issued_at?: string | null
          paid_at?: string | null
          pdf_url?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_invoice_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subscription_id?: string | null
          subtotal?: number
          tax_total?: number
          total?: number
          type: Database["public"]["Enums"]["invoice_type"]
          workspace_id: string
        }
        Update: {
          amount_paid?: number
          client_user_id?: string | null
          created_at?: string
          currency?: string
          due_date?: string | null
          hosted_url?: string | null
          id?: string
          issued_at?: string | null
          paid_at?: string | null
          pdf_url?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_invoice_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subscription_id?: string | null
          subtotal?: number
          tax_total?: number
          total?: number
          type?: Database["public"]["Enums"]["invoice_type"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      line_items: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          quantity: number
          tax_amount: number
          unit_amount: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          quantity?: number
          tax_amount?: number
          unit_amount: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          quantity?: number
          tax_amount?: number
          unit_amount?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      message_read_states: {
        Row: {
          channel_id: string | null
          direct_message_id: string | null
          id: string
          last_read_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel_id?: string | null
          direct_message_id?: string | null
          id?: string
          last_read_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string | null
          direct_message_id?: string | null
          id?: string
          last_read_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_read_states_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_read_states_direct_message_id_fkey"
            columns: ["direct_message_id"]
            isOneToOne: false
            referencedRelation: "direct_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_read_states_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          channel_id: string | null
          created_at: string
          direct_message_id: string | null
          id: string
          sender_id: string
          workspace_id: string
        }
        Insert: {
          body: string
          channel_id?: string | null
          created_at?: string
          direct_message_id?: string | null
          id?: string
          sender_id: string
          workspace_id: string
        }
        Update: {
          body?: string
          channel_id?: string | null
          created_at?: string
          direct_message_id?: string | null
          id?: string
          sender_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_direct_message_id_fkey"
            columns: ["direct_message_id"]
            isOneToOne: false
            referencedRelation: "direct_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          fee_amount: number | null
          id: string
          invoice_id: string | null
          method: string | null
          paid_at: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_payment_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          fee_amount?: number | null
          id?: string
          invoice_id?: string | null
          method?: string | null
          paid_at?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_payment_id?: string | null
          status: Database["public"]["Enums"]["payment_status"]
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          fee_amount?: number | null
          id?: string
          invoice_id?: string | null
          method?: string | null
          paid_at?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_payment_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          last_accessed_workspace_id: string | null
          onboarding_completed: boolean | null
          theme: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          last_accessed_workspace_id?: string | null
          onboarding_completed?: boolean | null
          theme?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          last_accessed_workspace_id?: string | null
          onboarding_completed?: boolean | null
          theme?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_last_accessed_workspace_fkey"
            columns: ["last_accessed_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          created_at: string
          id: string
          member_type: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_type: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          member_type?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          created_by: string
          flags: string | null
          id: string
          name: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          flags?: string | null
          id?: string
          name: string
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          flags?: string | null
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_entries: {
        Row: {
          amount: number
          category: Database["public"]["Enums"]["revenue_category"]
          created_at: string
          created_by: string
          description: string
          entry_date: string
          id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount: number
          category?: Database["public"]["Enums"]["revenue_category"]
          created_at?: string
          created_by: string
          description: string
          entry_date: string
          id?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          category?: Database["public"]["Enums"]["revenue_category"]
          created_at?: string
          created_by?: string
          description?: string
          entry_date?: string
          id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_entries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_targets: {
        Row: {
          created_at: string
          id: string
          month: string
          target_amount: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          month: string
          target_amount?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          month?: string
          target_amount?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_targets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          created_at: string
          id: string
          mrr: number
          name: string
          project_id: string
          renewal_date: string
          start_date: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mrr?: number
          name: string
          project_id: string
          renewal_date: string
          start_date: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mrr?: number
          name?: string
          project_id?: string
          renewal_date?: string
          start_date?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_events: {
        Row: {
          id: string
          payload: Json
          processed_at: string | null
          received_at: string
          type: string
        }
        Insert: {
          id: string
          payload: Json
          processed_at?: string | null
          received_at?: string
          type: string
        }
        Update: {
          id?: string
          payload?: Json
          processed_at?: string | null
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          amount: number
          billing_paused: boolean
          client_user_id: string | null
          created_at: string
          currency: string
          current_period_end: string | null
          current_period_start: string | null
          day_of_month: number | null
          description: string | null
          id: string
          interval: string
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_subscription_id: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          workspace_id: string
        }
        Insert: {
          amount: number
          billing_paused?: boolean
          client_user_id?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          day_of_month?: number | null
          description?: string | null
          id?: string
          interval?: string
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_subscription_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          workspace_id: string
        }
        Update: {
          amount?: number
          billing_paused?: boolean
          client_user_id?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          day_of_month?: number | null
          description?: string | null
          id?: string
          interval?: string
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_subscription_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          created_at: string
          id: string
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_activities: {
        Row: {
          activity_type: Database["public"]["Enums"]["task_activity_type"]
          actor_id: string
          body: string | null
          created_at: string
          id: string
          metadata: Json
          task_id: string
          workspace_id: string
        }
        Insert: {
          activity_type: Database["public"]["Enums"]["task_activity_type"]
          actor_id: string
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          task_id: string
          workspace_id: string
        }
        Update: {
          activity_type?: Database["public"]["Enums"]["task_activity_type"]
          actor_id?: string
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          task_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_activities_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activities_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          storage_path: string
          task_id: string
          uploaded_by: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          storage_path: string
          task_id: string
          uploaded_by: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          storage_path?: string
          task_id?: string
          uploaded_by?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          task_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          task_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          task_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_label_assignments: {
        Row: {
          created_at: string
          label_id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          label_id: string
          task_id: string
        }
        Update: {
          created_at?: string
          label_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_label_assignments_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "task_labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_label_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_labels: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_labels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_columns: {
        Row: {
          created_at: string
          id: string
          name: string
          position: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          position?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          position?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_columns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          column_id: string
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          estimated_minutes: number | null
          id: string
          position: number
          priority: Database["public"]["Enums"]["task_priority"]
          project_id: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          column_id: string
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          estimated_minutes?: number | null
          id?: string
          position?: number
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          column_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          estimated_minutes?: number | null
          id?: string
          position?: number
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "task_columns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_task_view_preferences: {
        Row: {
          settings: Json
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          settings?: Json
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          settings?: Json
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_task_view_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_task_view_preferences_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          billable: boolean
          created_at: string
          description: string | null
          ended_at: string | null
          id: string
          minutes: number | null
          source: Database["public"]["Enums"]["time_entry_source"]
          started_at: string | null
          task_id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          billable?: boolean
          created_at?: string
          description?: string | null
          ended_at?: string | null
          id?: string
          minutes?: number | null
          source: Database["public"]["Enums"]["time_entry_source"]
          started_at?: string | null
          task_id: string
          user_id: string
          workspace_id: string
        }
        Update: {
          billable?: boolean
          created_at?: string
          description?: string | null
          ended_at?: string | null
          id?: string
          minutes?: number | null
          source?: Database["public"]["Enums"]["time_entry_source"]
          started_at?: string | null
          task_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          id: string
          invited_by: string | null
          joined_at: string
          role: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          id?: string
          invited_by?: string | null
          joined_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          id?: string
          invited_by?: string | null
          joined_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string
          id: string
          invite_code: string
          logo_url: string | null
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          invite_code?: string
          logo_url?: string | null
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          invite_code?: string
          logo_url?: string | null
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_manage_project_members: {
        Args: { project_uuid: string; user_uuid: string }
        Returns: boolean
      }
      create_workspace: {
        Args: { workspace_name: string; workspace_slug: string }
        Returns: string
      }
      get_or_create_dm_channel: {
        Args: { p_user1_id: string; p_user2_id: string; p_workspace_id: string }
        Returns: {
          id: string
          user1_id: string
          user2_id: string
        }[]
      }
      get_user_role_in_workspace: {
        Args: { user_uuid: string; workspace_uuid: string }
        Returns: string
      }
      is_workspace_admin: {
        Args: { user_uuid: string; workspace_uuid: string }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { user_uuid: string; workspace_uuid: string }
        Returns: boolean
      }
      join_workspace: { Args: { invite_code_input: string }; Returns: string }
    }
    Enums: {
      deal_stage:
        | "lead"
        | "proposal_sent"
        | "negotiation"
        | "closed_won"
        | "closed_lost"
      email_delivery_status: "pending" | "sent" | "failed"
      invoice_status:
        | "draft"
        | "open"
        | "paid"
        | "past_due"
        | "void"
        | "uncollectible"
      invoice_type: "retainer" | "one_off"
      payment_provider: "stripe" | "gocardless"
      payment_status: "succeeded" | "pending" | "failed" | "refunded"
      project_status: "active" | "paused" | "completed"
      revenue_category: "service_income" | "project_income" | "other"
      subscription_status:
        | "active"
        | "past_due"
        | "canceled"
        | "incomplete"
        | "trialing"
        | "unpaid"
      task_priority: "high" | "medium" | "low"
      task_activity_type:
        | "comment"
        | "attachment_added"
        | "attachment_removed"
        | "label_added"
        | "label_removed"
        | "status_changed"
        | "priority_changed"
        | "assignee_changed"
        | "due_date_changed"
        | "created"
      time_entry_source: "timer" | "manual"
      workspace_role: "owner" | "employee" | "client"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      deal_stage: [
        "lead",
        "proposal_sent",
        "negotiation",
        "closed_won",
        "closed_lost",
      ],
      email_delivery_status: ["pending", "sent", "failed"],
      invoice_status: [
        "draft",
        "open",
        "paid",
        "past_due",
        "void",
        "uncollectible",
      ],
      invoice_type: ["retainer", "one_off"],
      payment_provider: ["stripe", "gocardless"],
      payment_status: ["succeeded", "pending", "failed", "refunded"],
      project_status: ["active", "paused", "completed"],
      revenue_category: ["service_income", "project_income", "other"],
      subscription_status: [
        "active",
        "past_due",
        "canceled",
        "incomplete",
        "trialing",
        "unpaid",
      ],
      task_priority: ["high", "medium", "low"],
      task_activity_type: [
        "comment",
        "attachment_added",
        "attachment_removed",
        "label_added",
        "label_removed",
        "status_changed",
        "priority_changed",
        "assignee_changed",
        "due_date_changed",
        "created",
      ],
      time_entry_source: ["timer", "manual"],
      workspace_role: ["owner", "employee", "client"],
    },
  },
} as const
