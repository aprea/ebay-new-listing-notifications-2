import EbayAuthToken from 'ebay-oauth-nodejs-client';
import axios from 'axios';
import { writeFileSync } from 'fs';

class eBayListingTracker {
  constructor() {
    // Initialize eBay OAuth client
    this.ebayAuthToken = new EbayAuthToken({
      clientId: process.env.EBAY_CLIENT_ID,
      clientSecret: process.env.EBAY_CLIENT_SECRET
    });

    this.sellerUsername = process.env.SELLER_USERNAME;
  }

  async getApplicationToken() {
    try {
      // Get application token for API access
      return await this.ebayAuthToken.getApplicationToken('PRODUCTION');
    } catch (error) {
      console.error('Error getting application token:', error.message);
      throw error;
    }
  }

  async getEbayListings(accessToken) {
    try {
      const response = await axios.get('https://api.ebay.com/buy/browse/v1/item_summary/search', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_AU',
        },
        params: {
          q: 'pokemon',
          filter: `sellers:{${process.env.SELLER_USERNAME}}`,
          limit: 50,
          sort: 'newlyListed'
        }
      });

      return response.data.itemSummaries || [];
    } catch (error) {
      console.error('Error fetching eBay listings:', error.message);
      return [];
    }
  }

  async findAndNotifyNewListings() {
    // Validate required environment variables
    if (!process.env.EBAY_CLIENT_ID || !process.env.SELLER_USERNAME) {
      console.error('Missing required environment variables');
      return { newListings: [], listingDetails: '' };
    }

    try {
      // Get application token
      const applicationToken = await this.getApplicationToken();

      // Fetch current listings
      const listings = await this.getEbayListings(applicationToken);

      // Prepare listing details for output
      const listingDetails = listings.map(listing => 
        `Title: ${listing.title}\nURL: ${listing.itemWebUrl}`
      ).join('\n\n');

      console.log(`Processed ${listings.length} new listings`);
      
      return { 
        newListings: listings, 
        listingDetails: listingDetails || 'No new listings found' 
      };
    } catch (error) {
      console.error('Error in finding new listings:', error);
      return { newListings: [], listingDetails: '' };
    }
  }
}

// Run the tracker
const tracker = new eBayListingTracker();
tracker.findAndNotifyNewListings()
  .then(result => {
    // Write result to a file for GitHub Actions to read
    writeFileSync('listing_results.json', JSON.stringify(result));
    process.exit(result.newListings.length > 0 ? 0 : 78);
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
