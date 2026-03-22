const mongoose = require('mongoose');

const SourceSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    uri: { type: String, trim: true },
    reliability: { type: String, enum: ['reliable', 'contested', 'unreliable', 'unclear'], default: 'unclear' },
    bias: { type: String, enum: ['left', 'center', 'right', 'unclear'], default: 'unclear' },
    notes: { type: String, trim: true },
    published_at: { type: String, trim: true },
  },
  { _id: false },
);

const EventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    category: { type: String, enum: ['conflict', 'release', 'cyber', 'politics', 'business', 'science', 'other'], default: 'other' },
    region: { type: String, enum: ['na', 'eu', 'latam', 'mea', 'apac', 'global'], default: 'global' },
    timeframe: { type: String, trim: true, default: 'last 30 days' },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    sources: { type: [SourceSchema], default: [] },
    source_summary: { type: String, trim: true },
    source_error: { type: String, trim: true },
    last_checked_at: { type: Date },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Event', EventSchema);
