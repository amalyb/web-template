/**
 * API endpoint for retrieving shipping label information
 * 
 * This endpoint is called by the ShipPage component to display
 * shipping labels and QR codes for lenders.
 */

const { getIntegrationSdk } = require('../api-util/integrationSdk');

module.exports = async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: 'Transaction ID is required' });
  }

  try {
    const integrationSdk = getIntegrationSdk();
    
    if (!integrationSdk) {
      console.error('[ship] Integration SDK not available');
      return res.status(500).json({ 
        error: 'Service configuration error',
        message: 'Integration SDK not configured'
      });
    }

    // Fetch transaction data
    const txResponse = await integrationSdk.transactions.show({
      id,
      include: ['listing', 'provider', 'customer'],
    });

    const transaction = txResponse.data.data;
    const protectedData = transaction.attributes.protectedData || {};
    const outbound = protectedData.outbound || {};

    // Build response with label data
    const labelData = {
      transactionId: id,
      qrCodeUrl: outbound.qrCodeUrl || protectedData.outboundQrCodeUrl,
      labelUrl: outbound.labelUrl || protectedData.outboundLabelUrl,
      trackingNumber: outbound.trackingNumber || protectedData.outboundTrackingNumber,
      trackingUrl: outbound.trackingUrl || protectedData.outboundTrackingUrl,
      shipByDate: outbound.shipByDate || protectedData.shipByDate,
    };

    // Check if we have at least one of the required fields
    if (!labelData.qrCodeUrl && !labelData.labelUrl) {
      console.warn(`[ship] No label data found for transaction ${id}`);
      return res.status(404).json({ 
        error: 'Label not found',
        message: 'No shipping label has been created for this transaction yet.'
      });
    }

    console.log(`[ship] Serving label data for transaction ${id}`);
    return res.status(200).json(labelData);

  } catch (error) {
    console.error('[ship] Error fetching label data:', error);
    
    // Handle specific error cases
    if (error.status === 404) {
      return res.status(404).json({ 
        error: 'Transaction not found',
        message: 'The requested transaction does not exist.'
      });
    }

    if (error.status === 403) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You do not have permission to view this transaction.'
      });
    }

    return res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to retrieve shipping label information.'
    });
  }
};

