import { Add, CheckCircle, Close, Delete, Done, ExpandMore } from '@mui/icons-material';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import { type FC, useState } from 'react';

type Ticket = {
  id: number;
  title: string;
  estimate: string | null;
};

type TicketListProps = {
  tickets: Ticket[];
  currentIndex: number;
  onSelectTicket: (index: number) => void;
  onAddTicket: (title: string) => void;
  onDeleteTicket: (id: number) => void;
};

const TicketList: FC<TicketListProps> = ({
  tickets,
  currentIndex,
  onSelectTicket,
  onAddTicket,
  onDeleteTicket,
}) => {
  const [newTicketTitle, setNewTicketTitle] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = () => {
    if (newTicketTitle.trim()) {
      onAddTicket(newTicketTitle);
      setNewTicketTitle('');
    }
  };
  return (
    <Accordion defaultExpanded>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Typography variant="h6">Tickets ({tickets.length})</Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        <List>
        {tickets.map((ticket, index) => (
          <ListItem
            key={ticket.id}
            disablePadding
            secondaryAction={
              <IconButton edge="end" onClick={() => onDeleteTicket(ticket.id)}>
                <Delete />
              </IconButton>
            }
          >
            <ListItemButton
              selected={index === currentIndex}
              onClick={() => onSelectTicket(index)}
            >
              <ListItemText primary={ticket.title} />
              {ticket.estimate && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    {ticket.estimate}
                  </Typography>
                  <CheckCircle color="success" fontSize="small" />
                </Box>
              )}
            </ListItemButton>
          </ListItem>
        ))}
        {isAdding ? (
          <ListItem
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) {
                if (newTicketTitle.trim()) {
                  handleAdd();
                } else {
                  setIsAdding(false);
                }
              }
            }}
          >
            <TextField
              fullWidth
              size="small"
              autoFocus
              value={newTicketTitle}
              onChange={(e) => setNewTicketTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
                if (e.key === 'Escape') setIsAdding(false);
              }}
              placeholder="Ticket title"
            />
            <IconButton onClick={handleAdd} color="primary">
              <Done />
            </IconButton>
            <IconButton onClick={() => setIsAdding(false)}>
              <Close />
            </IconButton>
          </ListItem>
        ) : (
          <ListItem>
            <Button
              fullWidth
              startIcon={<Add />}
              onClick={() => setIsAdding(true)}
            >
              Add Ticket
            </Button>
          </ListItem>
        )}
        </List>
      </AccordionDetails>
    </Accordion>
  );
};

export { TicketList };
