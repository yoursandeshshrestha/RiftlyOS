-- Enable realtime for channel_members table
-- Set replica identity to full so all columns are included in realtime events
ALTER TABLE channel_members REPLICA IDENTITY FULL;

-- Add table to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE channel_members;

-- Also enable for channels table for good measure
ALTER TABLE channels REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE channels;
