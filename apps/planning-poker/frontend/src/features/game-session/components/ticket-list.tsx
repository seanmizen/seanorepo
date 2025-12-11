import {
  Add,
  CheckCircle,
  Close,
  Delete,
  Done,
  Edit,
  ExpandMore,
} from '@mui/icons-material';
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
  TextField,
  Typography,
} from '@mui/material';
import { type FC, useEffect, useRef, useState } from 'react';

type Ticket = {
  id: number;
  title: string;
  estimate: string | null;
};

type VotesData = {
  votes: { attendeeId: string; hasVoted: boolean; vote: string | null }[];
  revealed: boolean;
};

type TicketListProps = {
  tickets: Ticket[];
  currentIndex: number;
  ticketVotesMap: Map<number, VotesData | undefined>;
  onSelectTicket: (index: number) => void;
  onAddTicket: (title: string) => void;
  onDeleteTicket: (id: number) => void;
  onUpdateTicketTitle: (id: number, title: string) => void;
};

const TicketList: FC<TicketListProps> = ({
  tickets,
  currentIndex,
  ticketVotesMap,
  onSelectTicket,
  onAddTicket,
  onDeleteTicket,
  onUpdateTicketTitle,
}) => {
  const [newTicketTitle, setNewTicketTitle] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingTicketId, setEditingTicketId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const listItemRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (listItemRefs.current[currentIndex]) {
      listItemRefs.current[currentIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [currentIndex]);

  const handleAdd = () => {
    if (newTicketTitle.trim()) {
      onAddTicket(newTicketTitle);
      setNewTicketTitle('');
    }
  };

  const handleStartEdit = (ticket: Ticket) => {
    setEditingTicketId(ticket.id);
    setEditingTitle(ticket?.title || '');
  };

  const handleSubmitEdit = () => {
    if (editingTicketId && editingTitle.trim()) {
      onUpdateTicketTitle(editingTicketId, editingTitle);
    }
    setEditingTicketId(null);
    setEditingTitle('');
  };

  return (
    <Accordion defaultExpanded>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Typography variant="h6">Tickets ({tickets.length})</Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0, maxHeight: 360, overflow: 'auto' }}>
        <List>
          {tickets.map((ticket, index) => {
            const votesData = ticketVotesMap.get(ticket.id);
            const voteCount =
              votesData?.votes.filter((v) => v.hasVoted).length || 0;
            const isEditing = editingTicketId === ticket.id;

            return (
              <ListItem
                key={ticket.id}
                disablePadding
                ref={(el) => {
                  listItemRefs.current[index] = el;
                }}
              >
                <ListItemButton
                  selected={index === currentIndex}
                  onClick={() => !isEditing && onSelectTicket(index)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    py: 1.5,
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    {isEditing ? (
                      <TextField
                        variant="standard"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSubmitEdit();
                          if (e.key === 'Escape') {
                            setEditingTicketId(null);
                            setEditingTitle('');
                          }
                        }}
                        onBlur={() => {
                          setEditingTicketId(null);
                          setEditingTitle('');
                        }}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        fullWidth
                        sx={{
                          '& .MuiInputBase-input': {
                            fontSize: '1rem',
                          },
                        }}
                      />
                    ) : (
                      <Typography
                        variant="body1"
                        noWrap
                        sx={{
                          direction: 'rtl',
                          textAlign: 'left',
                        }}
                      >
                        {/* RTL hijinks: replace trailing slashes */}
                        {ticket?.title?.replace(/\/$/g, '')}
                      </Typography>
                    )}
                    <Box
                      sx={{
                        display: 'flex',
                        gap: 2,
                        mt: 0.5,
                        flexWrap: 'wrap',
                      }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        {voteCount} votes cast
                      </Typography>
                      {ticket.estimate && (
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                          }}
                        >
                          <Typography variant="caption" color="success.main">
                            Final estimate:
                            {ticket.estimate}
                          </Typography>
                          <CheckCircle color="success" sx={{ fontSize: 14 }} />
                        </Box>
                      )}
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {isEditing ? (
                      <IconButton
                        size="small"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleSubmitEdit();
                        }}
                        color="primary"
                      >
                        <Done />
                      </IconButton>
                    ) : (
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEdit(ticket);
                        }}
                      >
                        <Edit />
                      </IconButton>
                    )}
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteTicket(ticket.id);
                      }}
                    >
                      <Delete />
                    </IconButton>
                  </Box>
                </ListItemButton>
              </ListItem>
            );
          })}
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
